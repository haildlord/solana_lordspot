use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

pub mod constants;
use constants::*;

declare_id!("5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo");

#[program]
pub mod solana_smart_contracts {
    use super::*;

    // WARNING : Before calling this function 
    // make sure `fee_recipient` has > 0 USDC already, or else buy_tickets() will revert for buyers
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
        max_claim_amount: u64
    ) -> Result<()> {
        // Validated up front, exactly as set_relay_config does — an initialize
        // that left max_tickets_per_purchase at 0 would deploy a protocol where
        // every purchase reverts.
        validate_relay_config(max_tickets_per_purchase, max_claim_amount)?;

        let state = &mut ctx.accounts.lords_pot_state;

        state.admin = ctx.accounts.signer.key();
        state.normal_max = normal_max;
        state.bonus_max = bonus_max;
        state.ticket_price = ticket_price;
        state.is_lords_pot_paused = false;

        state.ongoing_epoch = starting_epoch;

        // A freshly initialized account is born at the current layout, so it
        // never needs migrate_state. (_reserved is left as the zeroes `init`
        // already wrote.)
        state.version = STATE_VERSION;

        state.relay_fee_base = relay_fee_base;
        state.relay_fee_per_ticket = relay_fee_per_ticket;
        state.fee_recipient = fee_recipient;
        state.max_tickets_per_purchase = max_tickets_per_purchase;
        state.max_claim_amount = max_claim_amount;

        let bump = ctx.bumps.lords_pot_state;
        state.bump = bump;

        msg!("LordsPot Initialized! Admin: {}, Initial Epoch: {}", state.admin, state.ongoing_epoch);
        msg!(
            "Relay economics: base {} + {}/ticket → {}, max {} tickets/ix, max claim {}",
            relay_fee_base, relay_fee_per_ticket, fee_recipient, max_tickets_per_purchase, max_claim_amount
        );
        Ok(())
    }

    /// ONE-TIME upgrade of a v1 state account (52 data bytes) to the current
    /// layout, preserving every existing value.
    ///
    /// WHY THIS TAKES A RAW ACCOUNT — and why that is not the footgun it looks
    /// like. The account's stored bytes do not match LordsPotState yet; that is
    /// the entire problem being solved. Any typed wrapper would fail
    /// deserialization inside Anchor's account resolution, before a single line
    /// of this handler could run. So the account arrives unchecked and this
    /// code does the checking, explicitly and in order:
    ///
    ///   1. ADDRESS  — `seeds`/`bump` on the context re-derives the canonical
    ///                 PDA. An attacker-supplied account fails here, so "pass
    ///                 any account you like" is not available to them.
    ///   2. OWNER    — `owner = crate::ID`. Only accounts this program owns can
    ///                 be reallocated, and only ours can hold our state.
    ///   3. SIZE     — must be exactly LEGACY_STATE_SIZE. Anything else is
    ///                 already migrated (handled as a no-op) or unrecognised.
    ///   4. DISCRIM. — must carry LordsPotState's Anchor discriminator.
    ///   5. AUTHORITY— the admin pubkey is read from the v1 layout and must
    ///                 match the signer. Note this reads the LIVE admin from
    ///                 the account, NOT the ADMIN_PUBKEY compile-time constant,
    ///                 so an admin rotated via set_admin stays in control here.
    ///
    /// Front-running is a non-issue: every path requires the current admin's
    /// signature, so there is no version of this an attacker can win a race to
    /// call. The real hazard is operational, not adversarial — between
    /// deploying this bytecode and running this instruction, EVERY typed
    /// instruction (buy, claim, pause, withdraw) fails deserialization. Pause
    /// first, deploy, migrate, unpause.

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
        max_claim_amount: u64
    ) -> Result<()> {

        validate_relay_config(max_tickets_per_purchase, max_claim_amount)?;
        
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

        let mut writer = std::io::Cursor::new(&mut data[..]);
        state.try_serialize(&mut writer)?;

        msg!(
            "State migrated to v{}: admin {} / epoch {} / price {} preserved.",
            STATE_VERSION, state.admin, state.ongoing_epoch, state.ticket_price
        );
        Ok(())
    }

    /// Rotate the operational admin (pause/resume/update_epoch/claim co-signer,
    /// withdrawals, config).
    ///
    /// The INCOMING admin must sign this transaction too. That is not
    /// ceremony — a plain "set admin to this pubkey" instruction lets one typo
    /// hand the protocol to an address nobody holds the key for, permanently
    /// bricking every admin-gated instruction including withdrawals, with the
    /// vault still full. Requiring the new key to sign proves it exists and is
    /// controlled before anything is written.
    ///
    /// NOTE: this rotates the admin STORED IN STATE. `ADMIN_PUBKEY` in
    /// constants.rs is a separate, compile-time value used only by initialize,
    /// and is intentionally left alone — a rotation must not depend on
    /// redeploying bytecode.
    pub fn set_admin(ctx: Context<SetAdmin>) -> Result<()> {
        let new_admin = ctx.accounts.new_admin.key();
        let state = &mut ctx.accounts.lords_pot_state;

        require_keys_neq!(new_admin, state.admin, LordsPotError::SameAsPreviousAdmin);

        msg!("Admin rotated: {} → {}", state.admin, new_admin);
        state.admin = new_admin;
        Ok(())
    }


    /// Deliberately NOT gated on is_lords_pot_paused: re-pricing must stay
    /// available during an incident (e.g. a Base gas spike suddenly making the
    /// current fee loss-making). Raising the fee mid-flight can make an
    /// already-built user transaction revert — that is safe, not a loss: the
    /// purchase is atomic, so the user simply rebuilds and retries.

    // WARNING : Before calling this function and if updating `fee_recipient`, 
    // make sure fee_recipient has > 0 USDC already, or else buy_tickets() will revert for buyers
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

        // Policy ceiling, independent of the vault's balance. The solvency check
        // below only asks "can the vault afford this?" — which an absurd amount
        // originating upstream (bad prize-tier payload, settlement bug) would
        // happily pass right up to draining the vault. This asks the different,
        // necessary question: "is this amount plausible at all?"
        require!(
            amount <= ctx.accounts.lords_pot_state.max_claim_amount,
            LordsPotError::ClaimExceedsMaxAmount
        );

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

// WARNING : Before calling this function 
// make sure `fee_recipient` has > 0 USDC already, or else buy_tickets() will revert for buyers
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut, address = ADMIN_PUBKEY @ LordsPotError::Unauthorized)]
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

    // WARNING : Before calling this function 
    // make sure `fee_recipient` has > 0 USDC already, or else buy_tickets() will revert for buyers
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
    /// Pays the rent top-up for the larger account, and must be the admin
    /// currently stored in the account (verified in the handler against the v1
    /// layout — it cannot be read declaratively here, which is the whole
    /// reason this instruction exists).
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Intentionally raw — see the extensive rationale on migrate_state.
    /// A typed wrapper cannot be used because the stored bytes do not match the
    /// current struct yet. Address is pinned by the PDA seeds below and
    /// ownership by the `owner` constraint; size, discriminator and admin
    /// authority are all verified in the handler before anything is written.

    // This is crucial. Usually, Anchor checks if a file matches the blueprint perfectly. 
    // But because this is an old version of the file, it won't match the new blueprint yet! 
    // So we tell Anchor: "Don't check this automatically, it will crash. I will check it manually in the code.
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
pub struct SetAdmin<'info> {
    #[account(constraint = admin.key() == lords_pot_state.admin @ LordsPotError::Unauthorized)]
    pub admin: Signer<'info>,

    /// Must sign — proves the incoming key is live and controlled before the
    /// protocol is handed to it. See set_admin's docs.
    pub new_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"lords_pot_state"],
        bump = lords_pot_state.bump,
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,
}

// WARNING : Before calling this function 
// make sure `fee_recipient` has > 0 USDC already, or else buy_tickets() will revert for buyers
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

    // ------------------------------------------------------------------
    // EVERYTHING BELOW THIS LINE WAS ADDED AFTER THE FIRST DEPLOYMENT.
    //
    // Field ORDER above this line is frozen forever. Borsh is positional, so
    // the first 52 bytes of an already-deployed state account decode correctly
    // only as long as those seven fields keep their exact order and types.
    // migrate_state relies on precisely this: it grows the account and leaves
    // bytes 0..52 untouched, so a live protocol keeps its admin, epoch, price
    // and pause flag across the upgrade. New fields ALWAYS get appended here.
    // ------------------------------------------------------------------

    /// Layout version of this account. Lets any instruction — and any future
    /// migration — tell what shape it is actually looking at instead of
    /// assuming. Makes migrate_state idempotent: a retried migration after an
    /// RPC timeout is a no-op rather than a second, corrupting rewrite.
    pub version: u8,

    // --- Relay economics (admin-settable via set_relay_config) ---
    //
    // The relay fee lives HERE, on-chain, not in the frontend. It used to be a
    // separate SPL transfer instruction the frontend bolted on next to
    // buy_ticket, which meant anyone hand-rolling a transaction against this
    // program could simply omit it and have their tickets relayed to Base for
    // free while the relayer ate the real gas. Charged inside buy_ticket, it is
    // atomic with the purchase: no fee, no tickets.
    pub relay_fee_base: u64,
    pub relay_fee_per_ticket: u64,

    /// Fee destination OWNER (not its ATA). BuyTicket derives the ATA from this
    /// field, so a caller cannot redirect the fee to a wallet of their choosing.
    pub fee_recipient: Pubkey,

    /// Per-instruction ticket ceiling. Sized to the backend's Base chunk size
    /// (config.relay.baseTicketChunkSize) so one buy_ticket instruction maps to
    /// exactly one Base transaction — which is what makes the base+per-ticket
    /// fee mirror the real Base cost model (a fixed ~1.2M gas overhead per Base
    /// tx PLUS ~880k gas per ticket) at every purchase size.
    pub max_tickets_per_purchase: u8,

    /// Defense-in-depth ceiling on a single claim_winnings payout.
    ///
    /// The two-signature voucher already makes it impossible for a USER to
    /// invent an amount. This guards the other direction: a bad number arriving
    /// from upstream (a malformed Megapot prize-tier payload feeding settlement,
    /// a bug writing an absurd winAmount) would otherwise be signed by the
    /// backend and paid out by this program in good faith, bounded only by the
    /// vault's balance. This bounds it by policy instead.
    ///
    /// Fails CLOSED: a legitimate jackpot win above this ceiling cannot be
    /// claimed until an admin raises it. That is the intended tradeoff — a
    /// blocked payout is recoverable, an over-payout is not.
    pub max_claim_amount: u64,

    /// Pre-paid headroom for future fields.
    ///
    /// The account is allocated larger than it currently needs, so the NEXT
    /// field this protocol wants (a partner registry pointer, a per-partner
    /// cap, whatever an integration demands) is carved out of this reserve by
    /// shrinking it — no realloc, no rent top-up, no migration, no window where
    /// the deployed code and the stored bytes disagree. That disagreement is
    /// exactly what took the protocol down before this existed, and it is worth
    /// 128 bytes (~0.0009 SOL of rent, once) never to repeat it.
    ///
    /// To consume some: shrink this array by N and add fields totalling N
    /// bytes immediately ABOVE it. Total size is unchanged, so every existing
    /// account stays valid and the new fields read as zero until written.
    pub _reserved: [u8; 128],
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
}

/// Absolute backstop, independent of admin configuration — a mis-set
/// max_tickets_per_purchase can never widen the instruction past this.
/// (In practice Solana's 1232-byte transaction limit binds well before this
/// does; this exists so the ceiling is enforced by code, not by luck.)
pub const HARD_MAX_TICKETS_PER_PURCHASE: u8 = 100;

/// Current LordsPotState layout version. Bump this whenever fields are added
/// in a way that requires migrate_state to run.
pub const STATE_VERSION: u8 = 2;

/// Size of a v1 state account: 8-byte discriminator + the seven original
/// fields (1 + 1 + 8 + 8 + 1 + 1 + 32 = 52). This is the ONLY shape
/// migrate_state will accept as input — anything else is either already
/// migrated or not a state account we recognise.
pub const LEGACY_STATE_SIZE: usize = 60;

/// Byte range holding `admin` inside a v1 account: 8 (discriminator) + 20
/// (normal_max, bonus_max, ticket_price, ongoing_epoch, bump, is_paused).
/// Valid ONLY against a LEGACY_STATE_SIZE account, which migrate_state
/// verifies before reading here.
const LEGACY_ADMIN_OFFSET: usize = 28;

/// Shared by initialize and set_relay_config so the two can never drift into
/// disagreeing about what a valid configuration is.
fn validate_relay_config(max_tickets_per_purchase: u8, max_claim_amount: u64) -> Result<()> {
    require!(
        max_tickets_per_purchase >= 1 && max_tickets_per_purchase <= HARD_MAX_TICKETS_PER_PURCHASE,
        LordsPotError::InvalidMaxTicketsPerPurchase
    );
    require!(max_claim_amount > 0, LordsPotError::InvalidMaxClaimAmount);
    Ok(())
}