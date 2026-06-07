use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

pub mod constants;
use constants::*;

declare_id!("6MCjqsDP4zjxxg2AWCrjDGeKYUiWL3xpG2ccUxLXaMB9");

#[program]
pub mod solana_smart_contracts {
    use super::*;

    // ! The ticket_price must be expected in raw minimum units, meaning $1.00 must be passed as 1_000_000
    pub fn initialize(
        ctx: Context<Initialize>, 
        normal_max: u8, 
        bonus_max: u8,
        ticket_price: u64 
    ) -> Result<()> {
        let state = &mut ctx.accounts.lords_pot_state;
        
        state.admin = ctx.accounts.signer.key();
        state.normal_max = normal_max;
        state.bonus_max = bonus_max;
        state.ticket_price = ticket_price; 
        state.is_lords_pot_paused = false;

        let bump = ctx.bumps.lords_pot_state;
        state.bump = bump;

        msg!("LordsPot Initialized! Admin: {}", state.admin);
        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, tickets: Vec<Ticket>) -> Result<()> {

        require!(tickets.len() <= 100, LordsPotError::TooManyTickets); // ! make sure to ask @brain & @andrei about this

        let state = &ctx.accounts.lords_pot_state;

        require!(!tickets.is_empty(), LordsPotError::NoTicketsProvided);

        let decimals = ctx.accounts.usdc_mint.decimals;

        for ticket in tickets.iter() {
            require!(ticket.normal_ball.len() == 5, LordsPotError::InvalidTicketLength);
            require!(
                ticket.bonus_ball > 0 && ticket.bonus_ball <= state.bonus_max,
                LordsPotError::BonusBallOutOfBounds
            );

            let valid_normals = ticket.normal_ball.iter().all(|&ball|{
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
        });
        
        Ok(())
    }

    pub fn pause_protocol(ctx: Context<PauseProtocol>) -> Result<()> {
        let state = &mut ctx.accounts.lords_pot_state;
        state.is_lords_pot_paused = true;
        msg!("Protocol Paused.");
        Ok(())
    }

    pub fn resume_protocol(ctx: Context<ResumeProtocol>) -> Result<()> {
        let state = &mut ctx.accounts.lords_pot_state;
        state.is_lords_pot_paused = false;
        msg!("Protocol Resumed.");
        Ok(())
    }

    pub fn update_epoch(ctx: Context<UpdateEpoch>, normal_max: u8, bonus_max: u8) -> Result<()> {
        let state = &mut ctx.accounts.lords_pot_state;
    
        state.normal_max = normal_max;
        state.bonus_max = bonus_max;
        
        state.is_lords_pot_paused = false;
        msg!("Epoch Updated and Protocol Resumed. New Normals Max: {}, Bonus Max: {}", normal_max, bonus_max);
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
}

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

#[account]
#[derive(InitSpace)]
pub struct LordsPotState {
    pub normal_max: u8,
    pub bonus_max: u8,
    pub ticket_price: u64,
    pub bump: u8,
    pub is_lords_pot_paused: bool,
    pub admin: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Ticket {
    pub normal_ball: Vec<u8>,
    pub bonus_ball: u8
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
pub struct ResumeProtocol<'info> {
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
pub struct UpdateEpoch<'info> {
    #[account(mut, constraint = admin.key() == lords_pot_state.admin @ LordsPotError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"lords_pot_state"],
        bump = lords_pot_state.bump
    )]
    pub lords_pot_state: Account<'info, LordsPotState>,
}


#[error_code]
pub enum LordsPotError {
    #[msg("Ticket sales are frozen during the epoch rollover.")]
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
}