use anchor_lang::prelude::*;

// If we are compiling for production (mainnet-beta feature is turned on)
#[cfg(feature = "mainnet-beta")]
pub const USDC_MINT_ADDRESS: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// If we are compiling for devnet/localnet (mainnet-beta feature is turned OFF)
#[cfg(not(feature = "mainnet-beta"))]
pub const USDC_MINT_ADDRESS: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

// Regression guard for the exact bug that once made this switch dead: the
// `mainnet-beta` feature not being declared in Cargo.toml meant every build,
// regardless of flags, silently compiled the devnet branch. `cargo test`
// exercises whichever branch is active; `cargo test --features mainnet-beta`
// exercises the other. Only one of these two tests compiles per run (that's
// the point — it proves the cfg gate actually switches, not just that a
// constant has *some* value).
#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(feature = "mainnet-beta"))]
    #[test]
    fn default_build_uses_devnet_mint() {
        assert_eq!(
            USDC_MINT_ADDRESS.to_string(),
            "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        );
    }

    #[cfg(feature = "mainnet-beta")]
    #[test]
    fn mainnet_beta_build_uses_real_usdc_mint() {
        assert_eq!(
            USDC_MINT_ADDRESS.to_string(),
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        );
    }
}
