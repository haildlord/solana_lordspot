use anchor_lang::prelude::*;

// If we are compiling for production (mainnet-beta feature is turned on)
#[cfg(feature = "mainnet-beta")]
pub const USDC_MINT_ADDRESS: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// If we are compiling for devnet/localnet (mainnet-beta feature is turned OFF)
#[cfg(not(feature = "mainnet-beta"))]
pub const USDC_MINT_ADDRESS: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

// ! change it when deploying to mainnet
pub const ADMIN_PUBKEY : Pubkey = pubkey!("AigbEGvypACrUq7hgjNwCDfd8SfcgfTH6esHu8maHysS");