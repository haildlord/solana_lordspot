use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

pub mod constants;
use constants::*;

declare_id!("5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo");

#[program]
pub mod solana_smart_contracts {
    use super::*;

    // * WARNING : Before calling this function, make sure `fee_recipient`'s USDC
    // * ATA has been CREATED, or else buy_ticket() will revert for every buyer.
    pub fn initialize(
        ctx: Context<Initialize>,
        normal_max: u8,
        bonus_max: u8,
        ticket_price: u64,
        starting_epoch: u64,
        relay_fee_base: u64,
        relay_fee_per_ticket: u64,
        fee_recipient: Pubkey,
        max_tickets_per_purchase: u8,
        max_claim_amount: u64,
        treasury_authority: Pubkey
    ) -> Result<()> {
        validate_relay_config(max_tickets_per_purchase, max_claim_amount)?;
        validate_treasury(treasury_authority)?;

        let state = &mut ctx.accounts.lords_pot_state;

        state.admin = ctx.accounts.signer.key();
        state.normal_max = normal_max;
        state.bonus_max = bonus_max;
        state.ticket_price = ticket_price;
        state.is_lords_pot_paused = false;

        state.ongoing_epoch = starting_epoch;

        state.version = STATE_VERSION;

        state.relay_fee_base = relay_fee_base;
        state.relay_fee_per_ticket = relay_fee_per_ticket;
        state.fee_recipient = fee_recipient;
        state.max_tickets_per_purchase = max_tickets_per_purchase;
        state.max_claim_amount = max_claim_amount;
        state.treasury_authority = treasury_authority;

        let bump = ctx.bumps.lords_pot_state;
        state.bump = bump;

        msg!("LordsPot Initialized! Admin: {}, Initial Epoch: {}", state.admin, state.ongoing_epoch);
        msg!(
            "Relay economics: base {} + {}/ticket → {}, max {} tickets/ix, max claim {}",
            relay_fee_base, relay_fee_per_ticket, fee_recipient, max_tickets_per_purchase, max_claim_amount
        );
        Ok(())
    }
    // * The Most Dangerous Function, admin needs to be very carefull, read all the below comments one mistake and protocol will be stuck :
    // * WARNING : Before migrating the state make sure you go and increment below else migration wont work : 
    // *    `++STATE_VERSION` which is a `const` variable.
    // *    const `LEGACY_STATE_SIZE` update it to == to the old LordsPotState length. 
    // *        -- that is to say before calling `migrate_state` with updated UncheckedAccount, what was its old `LordsPotState` size.
    pub fn migrate_state(
        ctx: Context<MigrateState>,
        relay_fee_base: u64,
        relay_fee_per_ticket: u64,
        fee_recipient: Pubkey,
        max_tickets_per_purchase: u8,
        max_claim_amount: u64,
        treasury_authority: Pubkey
    ) -> Result<()> {

        validate_relay_config(max_tickets_per_purchase, max_claim_amount)?;
        validate_treasury(treasury_authority)?;

        let old_state_data = ctx.accounts.lords_pot_state.to_account_info();
        let old_state_len = old_state_data.data_len();
        let new_size = 8 + LordsPotState::INIT_SPACE;

        if old_state_len >= new_size {
            msg!("State already at v{} — nothing to migrate.", STATE_VERSION);
            return Ok(());
        }

        require!(old_state_len == LEGACY_STATE_SIZE, LordsPotError::UnexpectedStateSize);
       
        {
            // Safely read the raw bytes from the old account.
            // - `old_state_data`: The account information we just grabbed from Solana.
            // - `try_borrow_data()`: We must "try" to borrow the data because another part of 
            //   the program might be currently changing (writing to) it. If we read it while 
            //   someone else is changing it, we would get scrambled or corrupted data. This 
            //   ensures we only read the data if no one else is touching it.
            // - `?`: If the data is currently locked or busy, this symbol immediately stops 
            //   the function and returns a safe error message instead of crashing the program.
            let data = old_state_data.try_borrow_data()?;

            // Check : is it correct old PDA address
            require!(
                data[0..8] == *LordsPotState::DISCRIMINATOR,
                LordsPotError::InvalidStateAccount
            );

            let stored_admin = Pubkey::try_from(&data[LEGACY_ADMIN_OFFSET..LEGACY_ADMIN_OFFSET + 32])
                .map_err(|_| error!(LordsPotError::InvalidStateAccount))?;

            require_keys_eq!(ctx.accounts.admin.key(), stored_admin, LordsPotError::Unauthorized);
        }

        // Fetch the global Solana rulebook for rent (the Rent Sysvar).
        let rent = Rent::get()?;

        // Figure out exactly how many lamports are required for the new, larger PDA size.
        let required_lamports = rent.minimum_balance(new_size);

        // Check how many lamports are currently sitting in the old PDA.
        let current_lamports = old_state_data.lamports();

        // If the PDA is short on rent for the new size, transfer the exact difference 
        // from the admin's wallet into the PDA.
        if required_lamports > current_lamports {
            let top_up = required_lamports - current_lamports;
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.admin.to_account_info(),
                        to: old_state_data.clone(),
                    },
                ),
                top_up,
            )?;
        }

        // Physically stretch the old account to the new, larger size.
        // Solana automatically fills the newly added space with blank zeros,
        // which prevents new variables from accidentally starting with random garbage data
        old_state_data.resize(new_size)?;

        // Safely get WRITE access to the account's raw bytes.
        // - `mut` means mutable (changeable). 
        // - We ask Solana for permission to edit the file so we can write 
        //   the new settings into the space we just created.
        let mut data = old_state_data.try_borrow_mut_data()?;
        let mut state = LordsPotState::try_deserialize(&mut &data[..])?;

        state.version = STATE_VERSION;
        state.relay_fee_base = relay_fee_base;
        state.relay_fee_per_ticket = relay_fee_per_ticket;
        state.fee_recipient = fee_recipient;
        state.max_tickets_per_purchase = max_tickets_per_purchase;
        state.max_claim_amount = max_claim_amount;
        state.treasury_authority = treasury_authority;

        let mut writer = std::io::Cursor::new(&mut data[..]);
        state.try_serialize(&mut writer)?;

        msg!(
            "State migrated to v{}: admin {} / epoch {} / price {} preserved.",
            STATE_VERSION, state.admin, state.ongoing_epoch, state.ticket_price
        );
        Ok(())
    }

    /// Hand the admin role to a new key (pause/resume/epoch/claim-signing/config).
    pub fn set_admin(ctx: Context<SetAdmin>) -> Result<()> {
        let new_admin = ctx.accounts.new_admin.key();
        let state = &mut ctx.accounts.lords_pot_state;

        require_keys_neq!(new_admin, state.admin, LordsPotError::SameAsPreviousAdmin);

        msg!("Admin rotated: {} → {}", state.admin, new_admin);
        state.admin = new_admin;
        Ok(())
    }

    pub fn set_treasury_authority(ctx: Context<SetTreasuryAuthority>) -> Result<()> {
        let new_treasury = ctx.accounts.new_treasury.key();
        validate_treasury(new_treasury)?;

        let signer = ctx.accounts.authority.key();
        let state = &mut ctx.accounts.lords_pot_state;

        if state.treasury_authority == Pubkey::default() {
            // Mode 1: one-time bootstrap of a pre-existing account.
            require_keys_eq!(signer, state.admin, LordsPotError::Unauthorized);
            msg!("Treasury bootstrapped by admin → {}", new_treasury);
        } else {
            // Mode 2: normal rotation, treasury-to-treasury only.
            require_keys_eq!(signer, state.treasury_authority, LordsPotError::Unauthorized);
            require_keys_neq!(
                new_treasury,
                state.treasury_authority,
                LordsPotError::SameAsPreviousAdmin
            );
            msg!("Treasury rotated: {} → {}", state.treasury_authority, new_treasury);
        }

        state.treasury_authority = new_treasury;
        Ok(())
    }

    // * WARNING : Before calling this function, make sure `fee_recipient`'s USDC
    // * ATA has been CREATED, or else buy_ticket() will revert for every buyer.
    pub fn set_relay_config(
        ctx: Context<SetRelayConfig>,
        relay_fee_base: u64,
        relay_fee_per_ticket: u64,
        fee_recipient: Pubkey,
        max_tickets_per_purchase: u8,
        max_claim_amount: u64
    ) -> Result<()> {
        validate_relay_config(max_tickets_per_purchase, max_claim_amount)?;

        let state = &mut ctx.accounts.lords_pot_state;

        state.relay_fee_base = relay_fee_base;
        state.relay_fee_per_ticket = relay_fee_per_ticket;
        state.fee_recipient = fee_recipient;
        state.max_tickets_per_purchase = max_tickets_per_purchase;
        state.max_claim_amount = max_claim_amount;

        msg!(
            "Relay config updated: base {} + {}/ticket → {}, max {} tickets/ix, max claim {}",
            relay_fee_base, relay_fee_per_ticket, fee_recipient, max_tickets_per_purchase, max_claim_amount
        );
        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, tickets: Vec<Ticket>) -> Result<()> {

        let ticket_count = tickets.len() as u32;

        require!(ticket_count <= HARD_MAX_TICKETS_PER_PURCHASE as u32, LordsPotError::TooManyTickets);
        
        let state = &ctx.accounts.lords_pot_state;
        
        require!(ticket_count != 0, LordsPotError::NoTicketsProvided);
        
        require!(
            ticket_count <= state.max_tickets_per_purchase as u32,
            LordsPotError::ExceedsMaxTicketsPerPurchase
        );

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

        let total_amount = (ticket_count as u64)
            .checked_mul(state.ticket_price)
            .ok_or(LordsPotError::MathOverflow)?;

        // base + per-ticket, mirroring Base's own cost shape (fixed gas overhead
        // per transaction PLUS marginal gas per ticket).
        let relay_fee = state
            .relay_fee_per_ticket
            .checked_mul(ticket_count as u64)
            .ok_or(LordsPotError::MathOverflow)?
            .checked_add(state.relay_fee_base)
            .ok_or(LordsPotError::MathOverflow)?;

        let cpi_program = ctx.accounts.token_program.key();

        let cpi_accounts = TransferChecked {
            mint: ctx.accounts.usdc_mint.to_account_info(),
            from: ctx.accounts.buyer_usdc_account.to_account_info(),
            to: ctx.accounts.vault_usdc_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
        };
        let cpi_context = CpiContext::new(cpi_program, cpi_accounts);
        token_interface::transfer_checked(cpi_context, total_amount, decimals)?;

        if relay_fee > 0 {
            let fee_cpi_accounts = TransferChecked {
                mint: ctx.accounts.usdc_mint.to_account_info(),
                from: ctx.accounts.buyer_usdc_account.to_account_info(),
                to: ctx.accounts.fee_recipient_usdc_account.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            };
            let fee_cpi_context = CpiContext::new(cpi_program, fee_cpi_accounts);
            token_interface::transfer_checked(fee_cpi_context, relay_fee, decimals)?;
        }

        // WARNING - dont change the event below at any cost before consultation. 
        emit!(TicketPurchaseEvent {
            buyer: ctx.accounts.signer.key(),
            amount_paid: total_amount,
            tickets_bought: ticket_count,
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

    pub fn claim_winnings(ctx: Context<ClaimWinnings>, amount: u64) -> Result<()> {
        require!(amount > 0, LordsPotError::InvalidAmount);
        require!(
            amount <= ctx.accounts.lords_pot_state.max_claim_amount,
            LordsPotError::ClaimExceedsMaxAmount
        );
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

    /// Move USDC out of the vault. Used for recovering devnet funds, treasury
    /// rebalancing (CCTP bridging the Solana/Base imbalance), and emergencies.
    ///
    /// Requires the TREASURY key, not `admin`. This is the most powerful
    /// instruction here — uncapped, moves the whole vault — so it's exactly
    /// what the always-online hot key must not be able to do. Keep it cold.
    ///
    /// NOT blocked by the pause: this is the evacuation lever, it has to work
    /// mid-incident when everything else is frozen.
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
            admin: ctx.accounts.treasury.key(),
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

// * WARNING : Before calling this function 
// * make sure `LordsPotState.fee_recipient` has ATA already created, or else buy_tickets() will revert for buyers
#[derive(Accounts)]
pub struct Initialize<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
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
        init, 
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

    // * WARNING : Before calling this function, make sure `fee_recipient`'s USDC
    // * ATA has been CREATED, or else buy_ticket() will revert for every buyer.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = lords_pot_state.fee_recipient
    )]
    pub fee_recipient_usdc_account: InterfaceAccount<'info, TokenAccount>,

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
pub struct MigrateState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: A typed wrapper cannot be used because the stored bytes do not match the current struct yet
    #[account(
        mut,
        seeds = [b"lords_pot_state"],
        bump,
        owner = crate::ID @ LordsPotError::InvalidStateAccount
    )]
    pub lords_pot_state: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}



#[derive(Accounts)]
pub struct SetTreasuryAuthority<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Signs to prove the key is real and controlled before the vault is handed to it.
    pub new_treasury: Signer<'info>,

    #[account(
        mut,
        seeds = [b"lords_pot_state"],
        bump = lords_pot_state.bump,
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,
}

#[derive(Accounts)]
pub struct SetAdmin<'info> {
    #[account(mut, constraint = admin.key() == lords_pot_state.admin @ LordsPotError::Unauthorized)]
    pub admin: Signer<'info>,

    /// Signs to prove the key is real and controlled before the protocol is
    /// handed to it. Not `mut` — nothing is written to it and it pays nothing.
    pub new_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"lords_pot_state"],
        bump = lords_pot_state.bump,
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,
}

// * WARNING : Before calling this function 
// * make sure `fee_recipient` has > 0 USDC already, or else buy_tickets() will revert for buyers
#[derive(Accounts)]
pub struct SetRelayConfig<'info> {
    #[account(mut, constraint = admin.key() == lords_pot_state.admin @ LordsPotError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"lords_pot_state"],
        bump = lords_pot_state.bump,
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,
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
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(constraint = admin.key() == lords_pot_state.admin @ LordsPotError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"lords_pot_state"],
        bump = lords_pot_state.bump,
        constraint = !lords_pot_state.is_lords_pot_paused @ LordsPotError::ProtocolPaused
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,
    #[account(
        init_if_needed,  // keep this init_if_needed
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
    #[account(mut, constraint = treasury.key() == lords_pot_state.treasury_authority @ LordsPotError::Unauthorized)]
    pub treasury: Signer<'info>,

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

    // Any USDC token account the treasury chooses (own ATA, treasury, CCTP
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

    pub version: u8,
    pub relay_fee_base: u64,
    pub relay_fee_per_ticket: u64,
    pub fee_recipient: Pubkey,
    pub max_tickets_per_purchase: u8,

    pub max_claim_amount: u64,
    pub treasury_authority: Pubkey,
    pub _reserved: [u8; 96],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Ticket {
    pub normal_ball: Vec<u8>,
    pub bonus_ball: u8,
}

pub const HARD_MAX_TICKETS_PER_PURCHASE: u8 = 100;

pub const STATE_VERSION: u8 = 2;

const STATE_SIZE_AT_CURRENT_VERSION: usize = 238;

/// Build fails if the struct changes size without the version being bumped —
/// so the code and stored accounts can't silently disagree (which broke us once).
/// Carving a field out of `_reserved` doesn't trip this: same total size, no
/// migration needed. That's the point of the reserve.
const _: () = assert!(
    LordsPotState::INIT_SPACE == STATE_SIZE_AT_CURRENT_VERSION,
    "LordsPotState changed size. Bump STATE_VERSION, set LEGACY_STATE_SIZE to the PREVIOUS \
     total (8 + old field bytes), update STATE_SIZE_AT_CURRENT_VERSION, and write the migration."
);

pub const LEGACY_STATE_SIZE: usize = 60;

// Offset to get admin from LordsPotState, while migration to check for
const LEGACY_ADMIN_OFFSET: usize = 28;

// make sure the treasury authority is a real wallet address, not the empty one.
fn validate_treasury(treasury_authority: Pubkey) -> Result<()> {
    require_keys_neq!(
        treasury_authority,
        Pubkey::default(),  // Pubkey::default() : 0 address in solana : 11111111111111111111111111111111
        LordsPotError::InvalidTreasuryAuthority
    );
    Ok(())
}

fn validate_relay_config(max_tickets_per_purchase: u8, max_claim_amount: u64) -> Result<()> {
    require!(
        max_tickets_per_purchase >= 1 && max_tickets_per_purchase <= HARD_MAX_TICKETS_PER_PURCHASE,
        LordsPotError::InvalidMaxTicketsPerPurchase
    );
    require!(max_claim_amount > 0, LordsPotError::InvalidMaxClaimAmount);
    Ok(())
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
    #[msg("This purchase exceeds the maximum tickets allowed in a single instruction.")]
    ExceedsMaxTicketsPerPurchase,
    #[msg("Claim amount exceeds the protocol's maximum allowed single payout.")]
    ClaimExceedsMaxAmount,
    #[msg("max_tickets_per_purchase must be between 1 and the hard ceiling.")]
    InvalidMaxTicketsPerPurchase,
    #[msg("max_claim_amount must be greater than zero.")]
    InvalidMaxClaimAmount,
    #[msg("State account is not the expected legacy size — refusing to migrate it.")]
    UnexpectedStateSize,
    #[msg("Account is not a valid LordsPot state account.")]
    InvalidStateAccount,
    #[msg("The new admin is already the current admin.")]
    SameAsPreviousAdmin,
    #[msg("treasury_authority must not be the default (all-zero) pubkey.")]
    InvalidTreasuryAuthority,
}