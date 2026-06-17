use anchor_lang::prelude::*;

// If we are compiling for production (mainnet-beta feature is turned on)
#[cfg(feature = "mainnet-beta")]
pub const USDC_MINT_ADDRESS: Pubkey = pubkey!("EPjFW31aT7Lu8Upsg6A8b7H8bK35MS78766a4fW31g3");

// If we are compiling for devnet/localnet (mainnet-beta feature is turned OFF)
#[cfg(not(feature = "devnet-beta"))]
pub const USDC_MINT_ADDRESS: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

// # change it when deploying to mainnet
pub const ADMIN_PUBKEY : Pubkey = pubkey!("AigbEGvypACrUq7hgjNwCDfd8SfcgfTH6esHu8maHysS");