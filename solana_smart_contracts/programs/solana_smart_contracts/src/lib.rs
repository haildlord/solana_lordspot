use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

pub mod constants;
use constants::*;

declare_id!("5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo");

#[program]
pub mod solana_smart_contracts {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>, 
        normal_max: u8, 
        bonus_max: u8,
        ticket_price: u64,
        starting_epoch: u64 
    ) -> Result<()> {
        let state = &mut ctx.accounts.lords_pot_state;
        
        state.admin = ctx.accounts.signer.key();
        state.normal_max = normal_max;
        state.bonus_max = bonus_max;
        state.ticket_price = ticket_price; 
        state.is_lords_pot_paused = false;
        
        state.ongoing_epoch = starting_epoch; 

        let bump = ctx.bumps.lords_pot_state;
        state.bump = bump;

        msg!("LordsPot Initialized! Admin: {}, Initial Epoch: {}", state.admin, state.ongoing_epoch);
        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, tickets: Vec<Ticket>) -> Result<()> {
        require!(tickets.len() <= 100, LordsPotError::TooManyTickets); 

        let state = &ctx.accounts.lords_pot_state;

        require!(!tickets.is_empty(), LordsPotError::NoTicketsProvided);

        let decimals = ctx.accounts.usdc_mint.decimals;

        for ticket in tickets.iter() {
            require!(ticket.normal_ball.len() == 5, LordsPotError::InvalidTicketLength);
            require!(
                ticket.bonus_ball > 0 && ticket.bonus_ball <= state.bonus_max,
                LordsPotError::BonusBallOutOfBounds
            );

            let valid_normals = ticket.normal_ball.iter().all(|&ball| {
                ball > 0 && ball <= state.normal_max
            });
            require!(valid_normals, LordsPotError::NormalBallOutOfBounds);

            let is_strictly_sorted = ticket.normal_ball.windows(2).all(|w| w[0] < w[1]);
            require!(is_strictly_sorted, LordsPotError::BallsNotSortedOrDuplicated);
        }

        let total_amount = (tickets.len() as u64)
            .checked_mul(state.ticket_price)
            .ok_or(LordsPotError::MathOverflow)?;
            
        let cpi_accounts = TransferChecked {
            mint: ctx.accounts.usdc_mint.to_account_info(),
            from: ctx.accounts.buyer_usdc_account.to_account_info(),
            to: ctx.accounts.vault_usdc_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.key();
        let cpi_context = CpiContext::new(cpi_program, cpi_accounts);
        token_interface::transfer_checked(cpi_context, total_amount, decimals)?;

        emit!(TicketPurchaseEvent {
            buyer: ctx.accounts.signer.key(),
            amount_paid: total_amount,
            tickets_bought: tickets.len() as u32,
            tickets_data: tickets, 
            timestamp: Clock::get()?.unix_timestamp,
            epoch: state.ongoing_epoch,
        });
        
        Ok(())
    }

    pub fn pause_protocol(ctx: Context<PauseProtocol>) -> Result<()> {
        let state = &mut ctx.accounts.lords_pot_state;
        state.is_lords_pot_paused = true;
        msg!("Protocol Paused.");
        Ok(())
    }

    pub fn resume_protocol(ctx: Context<ResumeProtocol>, next_epoch: u64) -> Result<()> {
        let state = &mut ctx.accounts.lords_pot_state;
        state.is_lords_pot_paused = false;
        
        state.ongoing_epoch = next_epoch; 
        
        msg!("Protocol Resumed. Rolled over to Epoch: {}", state.ongoing_epoch);
        Ok(())
    }

    pub fn update_epoch(ctx: Context<UpdateEpoch>, normal_max: u8, bonus_max: u8) -> Result<()> {
        let state = &mut ctx.accounts.lords_pot_state;

        require!(
            normal_max != state.normal_max || bonus_max != state.bonus_max,
            LordsPotError::SameAsPreviousEpoch
        );
    
        state.normal_max = normal_max;
        state.bonus_max = bonus_max;

        msg!("Epoch Bounds Updated. New Normals Max: {}, Bonus Max: {}", normal_max, bonus_max);
        Ok(())
    }

    /// User-pulled payout authorized by a TWO-SIGNATURE voucher — no per-user
    /// balance is ever stored on-chain, so the relayer pays zero rent and
    /// zero fees for claims.
    ///
    /// Flow: the backend looks up the user's total claimable winnings in its
    /// own books (settlement + harvest data), builds this instruction with
    /// that exact `amount`, PARTIALLY SIGNS it with the admin key, and hands
    /// it to the frontend. The user counter-signs in their wallet (also
    /// paying the tx fee) and submits. USDC moves vault → user ATA directly.
    ///
    /// Why `amount` can be trusted: the admin co-signature. A user alone
    /// cannot invent a voucher (admin constraint fails); a stolen voucher
    /// pays only the wallet named in it, since the destination is the
    /// signer's own canonical ATA — it cannot be redirected.
    ///
    /// Replay safety: a Solana transaction executes at most once and its
    /// blockhash expires in ~60s, so a landed or expired voucher is dead.
    /// What the chain CANNOT see is double-ISSUANCE — the backend must never
    /// have two live unconfirmed vouchers out for the same user (one-live-
    /// voucher-per-user discipline, enforced off-chain).
    ///
    /// Gated on is_lords_pot_paused: pause is the protocol-wide emergency
    /// brake and freezes purchases AND claims. A voucher issued just before a
    /// pause reverts cleanly and dies at blockhash expiry — no stuck state.
    /// Only withdraw_vault_funds is exempt from the pause (evacuation lever).
    pub fn claim_winnings(ctx: Context<ClaimWinnings>, amount: u64) -> Result<()> {
        require!(amount > 0, LordsPotError::InvalidAmount);
        // Explicit solvency check for a clean, named error. The SPL token
        // program would reject an overdraw anyway — this fails faster and
        // tells ops exactly what is wrong (vault needs a refill, user is fine).
        require!(
            ctx.accounts.vault_usdc_account.amount >= amount,
            LordsPotError::InsufficientVaultFunds
        );

        let decimals = ctx.accounts.usdc_mint.decimals;
        let bump = ctx.bumps.vault_authority;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault_authority", &[bump]]];

        let cpi_accounts = TransferChecked {
            mint: ctx.accounts.usdc_mint.to_account_info(),
            from: ctx.accounts.vault_usdc_account.to_account_info(),
            to: ctx.accounts.user_usdc_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token_interface::transfer_checked(cpi_context, amount, decimals)?;

        emit!(WinningsClaimedEvent {
            user: ctx.accounts.user.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Admin-only withdrawal from the vault USDC ATA to any USDC token account.
    /// Three uses: recovering devnet USDC after testing, production treasury
    /// rebalancing (CCTP bridging of the Solana/Base imbalance), and emergency
    /// evacuation of funds.
    ///
    /// Deliberately NOT gated on is_lords_pot_paused: this is the evacuation
    /// lever — it must keep working mid-incident, precisely when everything
    /// else (purchases, claims) is frozen by the pause.
    pub fn withdraw_vault_funds(ctx: Context<WithdrawVaultFunds>, amount: u64) -> Result<()> {
        require!(amount > 0, LordsPotError::InvalidAmount);
        require!(
            ctx.accounts.vault_usdc_account.amount >= amount,
            LordsPotError::InsufficientVaultFunds
        );

        let decimals = ctx.accounts.usdc_mint.decimals;
        let bump = ctx.bumps.vault_authority;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault_authority", &[bump]]];

        let cpi_accounts = TransferChecked {
            mint: ctx.accounts.usdc_mint.to_account_info(),
            from: ctx.accounts.vault_usdc_account.to_account_info(),
            to: ctx.accounts.destination_usdc_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token_interface::transfer_checked(cpi_context, amount, decimals)?;

        emit!(VaultWithdrawalEvent {
            admin: ctx.accounts.admin.key(),
            destination: ctx.accounts.destination_usdc_account.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Vault withdrawal executed. Amount: {}", amount);
        Ok(())
    }
}

// --- EVENT DEFINITIONS ---

#[event]
pub struct TicketPurchaseEvent {
    pub buyer: Pubkey,
    pub amount_paid: u64,
    pub tickets_bought: u32,
    pub tickets_data: Vec<Ticket>,
    pub timestamp: i64,
    pub epoch: u64,
}

#[event]
pub struct WinningsClaimedEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultWithdrawalEvent {
    pub admin: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// --- CONTEXT DEFINITIONS ---

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut, address = ADMIN_PUBKEY @ LordsPotError::Unauthorized)]
    pub signer: Signer<'info>,

    #[account(
        init_if_needed, // ! while deploying change it to init and simplify the `Cargo.toml` as well !
        payer = signer,
        space = 8 + LordsPotState::INIT_SPACE,
        seeds = [b"lords_pot_state"], 
        bump
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,

    #[account(
        seeds = [b"vault_authority"],
        bump,
    )]
    pub vault_authority: SystemAccount<'info>,

    #[account(
        init_if_needed, // ! while deploying change it to init and simplify the `Cargo.toml` as well !
        payer = signer,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_usdc_account: InterfaceAccount<'info, TokenAccount>,

    #[account(address = USDC_MINT_ADDRESS)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,  
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [b"lords_pot_state"], 
        bump = lords_pot_state.bump,
        constraint = !lords_pot_state.is_lords_pot_paused @ LordsPotError::ProtocolPaused
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = signer
    )]
    pub buyer_usdc_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_authority
    )]
    pub vault_usdc_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"vault_authority"],
        bump,
    )]
    pub vault_authority: SystemAccount<'info>,

    #[account(address = USDC_MINT_ADDRESS)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
      
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>, 
}

#[derive(Accounts)]
pub struct PauseProtocol<'info> {
    #[account(mut, constraint = admin.key() == lords_pot_state.admin @ LordsPotError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"lords_pot_state"], 
        bump = lords_pot_state.bump,
        constraint = !lords_pot_state.is_lords_pot_paused @ LordsPotError::ProtocolPaused
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,
}

#[derive(Accounts)]
#[instruction(next_epoch: u64)]
pub struct ResumeProtocol<'info> {
    #[account(mut, constraint = admin.key() == lords_pot_state.admin @ LordsPotError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"lords_pot_state"], 
        bump = lords_pot_state.bump,
        constraint = lords_pot_state.is_lords_pot_paused @ LordsPotError::ProtocolNotPaused,
        constraint = next_epoch > lords_pot_state.ongoing_epoch @ LordsPotError::InvalidNextEpoch
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,
}

#[derive(Accounts)]
pub struct UpdateEpoch<'info> {
    #[account(mut, constraint = admin.key() == lords_pot_state.admin @ LordsPotError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"lords_pot_state"],
        bump = lords_pot_state.bump,
        constraint = lords_pot_state.is_lords_pot_paused @ LordsPotError::ProtocolNotPaused
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {

    /// The winner receiving the payout. Must sign: proves live control of
    /// the destination wallet and gives explicit consent. Also the fee
    /// payer, so the relayer spends nothing on claims.
    #[account(mut)]
    pub user: Signer<'info>,

    /// The backend admin key must ALSO sign this same transaction — the
    /// co-signature is what authorizes `amount`. Neither party alone can
    /// move a single unit: the user can't invent a voucher, and the admin
    /// can't pay out to a wallet that didn't counter-sign.
    #[account(constraint = admin.key() == lords_pot_state.admin @ LordsPotError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"lords_pot_state"],
        bump = lords_pot_state.bump,
        constraint = !lords_pot_state.is_lords_pot_paused @ LordsPotError::ProtocolPaused
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,

    // Destination is the SIGNER's own canonical ATA (derived, not passed) —
    // a leaked voucher cannot be redirected to any other wallet.
    // init_if_needed is PERMANENT here by design: creates the user's USDC ATA
    // on first claim (user pays their own rent). The ATA address is canonical,
    // so there is nothing an attacker can pre-create to hijack it.
    #[account(
        init_if_needed,                       // keep this init_if_needed
        payer = user,
        associated_token::mint = usdc_mint,
        associated_token::authority = user,
    )]
    pub user_usdc_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_authority
    )]
    pub vault_usdc_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"vault_authority"],
        bump,
    )]
    pub vault_authority: SystemAccount<'info>,

    #[account(address = USDC_MINT_ADDRESS)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct WithdrawVaultFunds<'info> {

    #[account(mut, constraint = admin.key() == lords_pot_state.admin @ LordsPotError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"lords_pot_state"],
        bump = lords_pot_state.bump,
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_authority
    )]
    pub vault_usdc_account: InterfaceAccount<'info, TokenAccount>,

    // Any USDC token account the admin chooses (own ATA, treasury, CCTP
    // depositor). transfer_checked enforces the mint match at the token
    // program level too; this constraint just fails faster and clearer.
    #[account(
        mut,
        constraint = destination_usdc_account.mint == usdc_mint.key() @ LordsPotError::InvalidDestination
    )]
    pub destination_usdc_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"vault_authority"],
        bump,
    )]
    pub vault_authority: SystemAccount<'info>,

    #[account(address = USDC_MINT_ADDRESS)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

// --- STATE STRUCTS ---

#[account]
#[derive(InitSpace)]
pub struct LordsPotState {
    pub normal_max: u8,
    pub bonus_max: u8,
    pub ticket_price: u64,
    pub ongoing_epoch: u64,
    pub bump: u8,
    pub is_lords_pot_paused: bool,
    pub admin: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Ticket {
    pub normal_ball: Vec<u8>,
    pub bonus_ball: u8,
}

// --- ERROR CODES ---

#[error_code]
pub enum LordsPotError {
    #[msg("Protocol is paused — purchases and claims are temporarily frozen.")]
    ProtocolPaused,
    #[msg("The protocol is already active and not paused.")]
    ProtocolNotPaused,
    #[msg("You are not authorized to perform this admin action.")]
    Unauthorized,
    #[msg("You must provide at least one ticket to purchase.")]
    NoTicketsProvided,
    #[msg("A ticket must contain exactly 5 normal numbers.")]
    InvalidTicketLength,
    #[msg("A regular number selection exceeds the max allowed for this round.")]
    NormalBallOutOfBounds,
    #[msg("The bonus number selection exceeds the max allowed for this round.")]
    BonusBallOutOfBounds,
    #[msg("Ticket numbers must be strictly unique and submitted in ascending order.")]
    BallsNotSortedOrDuplicated,
    #[msg("A mathematical overflow occurred during price calculation.")]
    MathOverflow,
    #[msg("You cannot purchase more than 100 tickets in a single transaction.")]
    TooManyTickets,
    #[msg("Same as values as Previous Epoch")]
    SameAsPreviousEpoch,
    #[msg("The provided next epoch must be strictly greater than the current ongoing epoch.")]
    InvalidNextEpoch,
    #[msg("Amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Vault does not hold enough USDC for this transfer.")]
    InsufficientVaultFunds,
    #[msg("Destination token account mint does not match the vault USDC mint.")]
    InvalidDestination,
}