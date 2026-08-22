/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/solana_smart_contracts.json`.
 */
export type SolanaSmartContracts = {
  "address": "5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo",
  "metadata": {
    "name": "solanaSmartContracts",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "buyTicket",
      "discriminator": [
        11,
        24,
        17,
        193,
        168,
        116,
        164,
        169
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "lordsPotState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  114,
                  100,
                  115,
                  95,
                  112,
                  111,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "buyerUsdcAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "signer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vaultUsdcAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultAuthority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "feeRecipientUsdcAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "lords_pot_state.fee_recipient",
                "account": "lordsPotState"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "address": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "tickets",
          "type": {
            "vec": {
              "defined": {
                "name": "ticket"
              }
            }
          }
        }
      ]
    },
    {
      "name": "claimWinnings",
      "docs": [
        "User-pulled payout authorized by a TWO-SIGNATURE voucher — no per-user",
        "balance is ever stored on-chain, so the relayer pays zero rent and",
        "zero fees for claims.",
        "",
        "Flow: the backend looks up the user's total claimable winnings in its",
        "own books (settlement + harvest data), builds this instruction with",
        "that exact `amount`, PARTIALLY SIGNS it with the admin key, and hands",
        "it to the frontend. The user counter-signs in their wallet (also",
        "paying the tx fee) and submits. USDC moves vault → user ATA directly.",
        "",
        "Why `amount` can be trusted: the admin co-signature. A user alone",
        "cannot invent a voucher (admin constraint fails); a stolen voucher",
        "pays only the wallet named in it, since the destination is the",
        "signer's own canonical ATA — it cannot be redirected.",
        "",
        "Replay safety: a Solana transaction executes at most once and its",
        "blockhash expires in ~60s, so a landed or expired voucher is dead.",
        "What the chain CANNOT see is double-ISSUANCE — the backend must never",
        "have two live unconfirmed vouchers out for the same user (one-live-",
        "voucher-per-user discipline, enforced off-chain).",
        "",
        "Gated on is_lords_pot_paused: pause is the protocol-wide emergency",
        "brake and freezes purchases AND claims. A voucher issued just before a",
        "pause reverts cleanly and dies at blockhash expiry — no stuck state.",
        "Only withdraw_vault_funds is exempt from the pause (evacuation lever)."
      ],
      "discriminator": [
        161,
        215,
        24,
        59,
        14,
        236,
        242,
        221
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "The winner receiving the payout. Must sign: proves live control of",
            "the destination wallet and gives explicit consent. Also the fee",
            "payer, so the relayer spends nothing on claims."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "admin",
          "docs": [
            "The backend admin key must ALSO sign this same transaction — the",
            "co-signature is what authorizes `amount`. Neither party alone can",
            "move a single unit: the user can't invent a voucher, and the admin",
            "can't pay out to a wallet that didn't counter-sign."
          ],
          "signer": true
        },
        {
          "name": "lordsPotState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  114,
                  100,
                  115,
                  95,
                  112,
                  111,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "userUsdcAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vaultUsdcAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultAuthority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "address": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "Becomes the protocol admin, stored in LordsPotState.admin.",
            "",
            "Deliberately unconstrained: there is no hardcoded admin to remember to",
            "change before mainnet. `initialize` can only ever succeed ONCE (the PDA",
            "is `init`, not `init_if_needed`), so this is first-caller-wins — run it",
            "immediately after deploying and verify `state.admin` afterwards. If",
            "someone else were to win that race the vault is still empty at that",
            "point, so the cost is a redeploy, not funds."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "lordsPotState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  114,
                  100,
                  115,
                  95,
                  112,
                  111,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vaultUsdcAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultAuthority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "usdcMint",
          "address": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "normalMax",
          "type": "u8"
        },
        {
          "name": "bonusMax",
          "type": "u8"
        },
        {
          "name": "ticketPrice",
          "type": "u64"
        },
        {
          "name": "startingEpoch",
          "type": "u64"
        },
        {
          "name": "relayFeeBase",
          "type": "u64"
        },
        {
          "name": "relayFeePerTicket",
          "type": "u64"
        },
        {
          "name": "feeRecipient",
          "type": "pubkey"
        },
        {
          "name": "maxTicketsPerPurchase",
          "type": "u8"
        },
        {
          "name": "maxClaimAmount",
          "type": "u64"
        },
        {
          "name": "treasuryAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "migrateState",
      "docs": [
        "Grows an old state account to the current layout, keeping every existing",
        "value.",
        "",
        "Takes a RAW account because the stored bytes don't match LordsPotState",
        "yet — that's the whole problem. A typed account would fail to decode",
        "before this code could run. So the checks are done by hand instead:",
        "address (PDA seeds), owner, exact old size, discriminator, and the admin",
        "read from the old layout. An attacker can't pass a fake account (seeds)",
        "or call it at all (needs the admin signature).",
        "",
        "Careful: between deploying this bytecode and running this, every other",
        "instruction fails to decode. Pause first, deploy, migrate, unpause."
      ],
      "discriminator": [
        34,
        189,
        226,
        222,
        218,
        156,
        19,
        213
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Pays the rent top-up for the larger account, and must be the admin",
            "currently stored in the account (verified in the handler against the v1",
            "layout — it cannot be read declaratively here, which is the whole",
            "reason this instruction exists)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "lordsPotState",
          "docs": [
            "A typed wrapper cannot be used because the stored bytes do not match the",
            "current struct yet. Address is pinned by the PDA seeds below and",
            "ownership by the `owner` constraint; size, discriminator and admin",
            "authority are all verified in the handler before anything is written."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  114,
                  100,
                  115,
                  95,
                  112,
                  111,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "relayFeeBase",
          "type": "u64"
        },
        {
          "name": "relayFeePerTicket",
          "type": "u64"
        },
        {
          "name": "feeRecipient",
          "type": "pubkey"
        },
        {
          "name": "maxTicketsPerPurchase",
          "type": "u8"
        },
        {
          "name": "maxClaimAmount",
          "type": "u64"
        },
        {
          "name": "treasuryAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "pauseProtocol",
      "discriminator": [
        144,
        95,
        0,
        107,
        119,
        39,
        248,
        141
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "lordsPotState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  114,
                  100,
                  115,
                  95,
                  112,
                  111,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "resumeProtocol",
      "discriminator": [
        62,
        91,
        76,
        18,
        174,
        87,
        87,
        208
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "lordsPotState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  114,
                  100,
                  115,
                  95,
                  112,
                  111,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "nextEpoch",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setAdmin",
      "docs": [
        "Hand the admin role to a new key (pause/resume/epoch/claim-signing/config).",
        "",
        "The new admin signs too, so a typo can't hand the protocol to an address",
        "nobody owns — which would lock every admin instruction forever."
      ],
      "discriminator": [
        251,
        163,
        0,
        52,
        91,
        194,
        187,
        92
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "`mut` because this is the natural fee payer."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "newAdmin",
          "docs": [
            "Signs to prove the key is real and controlled before the protocol is",
            "handed to it. Not `mut` — nothing is written to it and it pays nothing."
          ],
          "signer": true
        },
        {
          "name": "lordsPotState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  114,
                  100,
                  115,
                  95,
                  112,
                  111,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "setRelayConfig",
      "docs": [
        "Deliberately NOT gated on is_lords_pot_paused: re-pricing must stay",
        "available during an incident (e.g. a Base gas spike suddenly making the",
        "current fee loss-making). Raising the fee mid-flight can make an",
        "already-built user transaction revert — that is safe, not a loss: the",
        "purchase is atomic, so the user simply rebuilds and retries."
      ],
      "discriminator": [
        205,
        63,
        195,
        69,
        46,
        165,
        156,
        210
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "lordsPotState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  114,
                  100,
                  115,
                  95,
                  112,
                  111,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "relayFeeBase",
          "type": "u64"
        },
        {
          "name": "relayFeePerTicket",
          "type": "u64"
        },
        {
          "name": "feeRecipient",
          "type": "pubkey"
        },
        {
          "name": "maxTicketsPerPurchase",
          "type": "u8"
        },
        {
          "name": "maxClaimAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setTreasuryAuthority",
      "docs": [
        "Set or rotate the treasury key (the only key that can withdraw the vault).",
        "",
        "Two modes:",
        "BOOTSTRAP — treasury is still all-zero (an account migrated before this",
        "field existed). Admin sets it once. Without this, the vault would be",
        "locked forever: withdrawing and rotating both need a signature from",
        "the zero key, which nobody can produce.",
        "ROTATION  — treasury is already set. Only the current treasury can hand",
        "it over. Admin deliberately cannot, or stealing the hot key would",
        "still get you the vault and the whole split would be pointless.",
        "",
        "The new key signs too, so a typo can't strand the vault."
      ],
      "discriminator": [
        131,
        244,
        37,
        32,
        108,
        28,
        31,
        8
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Current treasury — or the admin, only while treasury is still unset",
            "(bootstrap). Which one is required depends on the stored value, so the",
            "handler checks it rather than a constraint here.",
            "",
            "`mut` because this is the natural fee payer. Note the fee payer is chosen",
            "by the CLIENT when it builds the transaction, not by anything here —",
            "`mut` only declares that the account's lamports may change."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "newTreasury",
          "docs": [
            "Signs to prove the key is real and controlled before the vault is handed",
            "to it. Not `mut` — nothing is written to it and it pays nothing."
          ],
          "signer": true
        },
        {
          "name": "lordsPotState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  114,
                  100,
                  115,
                  95,
                  112,
                  111,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "updateEpoch",
      "discriminator": [
        218,
        126,
        55,
        95,
        96,
        35,
        241,
        92
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "lordsPotState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  114,
                  100,
                  115,
                  95,
                  112,
                  111,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "normalMax",
          "type": "u8"
        },
        {
          "name": "bonusMax",
          "type": "u8"
        }
      ]
    },
    {
      "name": "withdrawVaultFunds",
      "docs": [
        "Move USDC out of the vault. Used for recovering devnet funds, treasury",
        "rebalancing (CCTP bridging the Solana/Base imbalance), and emergencies.",
        "",
        "Requires the TREASURY key, not `admin`. This is the most powerful",
        "instruction here — uncapped, moves the whole vault — so it's exactly",
        "what the always-online hot key must not be able to do. Keep it cold.",
        "",
        "NOT blocked by the pause: this is the evacuation lever, it has to work",
        "mid-incident when everything else is frozen."
      ],
      "discriminator": [
        230,
        233,
        148,
        2,
        238,
        220,
        211,
        165
      ],
      "accounts": [
        {
          "name": "treasury",
          "docs": [
            "TREASURY key, NOT `admin`. The hot admin key co-signs claim vouchers",
            "automatically from the backend; letting that same key empty the vault",
            "would mean a server compromise is a total loss. See",
            "LordsPotState::treasury_authority."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "lordsPotState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  114,
                  100,
                  115,
                  95,
                  112,
                  111,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "vaultUsdcAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultAuthority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "destinationUsdcAccount",
          "writable": true
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "address": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "lordsPotState",
      "discriminator": [
        9,
        156,
        79,
        177,
        160,
        143,
        34,
        17
      ]
    }
  ],
  "events": [
    {
      "name": "ticketPurchaseEvent",
      "discriminator": [
        106,
        28,
        171,
        84,
        39,
        119,
        78,
        243
      ]
    },
    {
      "name": "vaultWithdrawalEvent",
      "discriminator": [
        91,
        249,
        120,
        213,
        56,
        120,
        34,
        142
      ]
    },
    {
      "name": "winningsClaimedEvent",
      "discriminator": [
        30,
        231,
        120,
        152,
        158,
        82,
        26,
        135
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "protocolPaused",
      "msg": "Protocol is paused — purchases and claims are temporarily frozen."
    },
    {
      "code": 6001,
      "name": "protocolNotPaused",
      "msg": "The protocol is already active and not paused."
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "You are not authorized to perform this admin action."
    },
    {
      "code": 6003,
      "name": "noTicketsProvided",
      "msg": "You must provide at least one ticket to purchase."
    },
    {
      "code": 6004,
      "name": "invalidTicketLength",
      "msg": "A ticket must contain exactly 5 normal numbers."
    },
    {
      "code": 6005,
      "name": "normalBallOutOfBounds",
      "msg": "A regular number selection exceeds the max allowed for this round."
    },
    {
      "code": 6006,
      "name": "bonusBallOutOfBounds",
      "msg": "The bonus number selection exceeds the max allowed for this round."
    },
    {
      "code": 6007,
      "name": "ballsNotSortedOrDuplicated",
      "msg": "Ticket numbers must be strictly unique and submitted in ascending order."
    },
    {
      "code": 6008,
      "name": "mathOverflow",
      "msg": "A mathematical overflow occurred during price calculation."
    },
    {
      "code": 6009,
      "name": "tooManyTickets",
      "msg": "You cannot purchase more than 100 tickets in a single transaction."
    },
    {
      "code": 6010,
      "name": "sameAsPreviousEpoch",
      "msg": "Same as values as Previous Epoch"
    },
    {
      "code": 6011,
      "name": "invalidNextEpoch",
      "msg": "The provided next epoch must be strictly greater than the current ongoing epoch."
    },
    {
      "code": 6012,
      "name": "invalidAmount",
      "msg": "Amount must be greater than zero."
    },
    {
      "code": 6013,
      "name": "insufficientVaultFunds",
      "msg": "Vault does not hold enough USDC for this transfer."
    },
    {
      "code": 6014,
      "name": "invalidDestination",
      "msg": "Destination token account mint does not match the vault USDC mint."
    },
    {
      "code": 6015,
      "name": "exceedsMaxTicketsPerPurchase",
      "msg": "This purchase exceeds the maximum tickets allowed in a single instruction."
    },
    {
      "code": 6016,
      "name": "claimExceedsMaxAmount",
      "msg": "Claim amount exceeds the protocol's maximum allowed single payout."
    },
    {
      "code": 6017,
      "name": "invalidMaxTicketsPerPurchase",
      "msg": "max_tickets_per_purchase must be between 1 and the hard ceiling."
    },
    {
      "code": 6018,
      "name": "invalidMaxClaimAmount",
      "msg": "max_claim_amount must be greater than zero."
    },
    {
      "code": 6019,
      "name": "unexpectedStateSize",
      "msg": "State account is not the expected legacy size — refusing to migrate it."
    },
    {
      "code": 6020,
      "name": "invalidStateAccount",
      "msg": "Account is not a valid LordsPot state account."
    },
    {
      "code": 6021,
      "name": "sameAsPreviousAdmin",
      "msg": "The new admin is already the current admin."
    },
    {
      "code": 6022,
      "name": "invalidTreasuryAuthority",
      "msg": "treasury_authority must not be the default (all-zero) pubkey."
    }
  ],
  "types": [
    {
      "name": "lordsPotState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "normalMax",
            "type": "u8"
          },
          {
            "name": "bonusMax",
            "type": "u8"
          },
          {
            "name": "ticketPrice",
            "type": "u64"
          },
          {
            "name": "ongoingEpoch",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "isLordsPotPaused",
            "type": "bool"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "version",
            "docs": [
              "Which layout this account uses. Lets migrate_state be safely re-run",
              "(a retry after an RPC timeout is a no-op, not a corrupting rewrite)."
            ],
            "type": "u8"
          },
          {
            "name": "relayFeeBase",
            "type": "u64"
          },
          {
            "name": "relayFeePerTicket",
            "type": "u64"
          },
          {
            "name": "feeRecipient",
            "docs": [
              "Fee destination OWNER (not its token account). BuyTicket derives the ATA",
              "from this, so a caller can't redirect the fee to themselves."
            ],
            "type": "pubkey"
          },
          {
            "name": "maxTicketsPerPurchase",
            "docs": [
              "Max tickets in ONE buy_ticket instruction. Match it to the backend's",
              "Base chunk size, so one instruction = one Base transaction. That's what",
              "keeps base+per-ticket fees lined up with real Base gas at any size."
            ],
            "type": "u8"
          },
          {
            "name": "maxClaimAmount",
            "docs": [
              "Sanity ceiling on a single payout.",
              "",
              "The two signatures already stop a USER inventing an amount. This guards",
              "the opposite direction: a bad number from upstream (bad Megapot payload,",
              "settlement bug) that the backend would sign and this program would pay",
              "in good faith, limited only by the vault balance.",
              "",
              "Fails CLOSED — a real jackpot above this can't be claimed until admin",
              "raises it. Deliberate: a blocked payout is fixable, an overpayment isn't."
            ],
            "type": "u64"
          },
          {
            "name": "treasuryAuthority",
            "docs": [
              "THE COLD KEY — the only key that can withdraw the vault. Deliberately",
              "NOT `admin`.",
              "",
              "`admin` is hot: it sits in the backend env and auto-signs claim vouchers",
              "constantly. If that same key could drain the vault, a leaked env var or",
              "one bad dependency would mean total loss.",
              "",
              "Only set_treasury_authority changes it, and only the CURRENT treasury",
              "can — if admin could reassign it, stealing the hot key would still get",
              "you the vault, just one step later."
            ],
            "type": "pubkey"
          },
          {
            "name": "reserved",
            "docs": [
              "Spare bytes, already paid for, for future fields.",
              "",
              "The account is bigger than it needs. The next field we want gets carved",
              "out of here — no resize, no rent top-up, no migration, no window where",
              "deployed code and stored bytes disagree (which is what broke us once).",
              "",
              "To use some: shrink this by N, add N bytes of fields directly above it.",
              "Total size never changes, so live accounts stay valid and new fields",
              "read as zero until written. `treasury_authority` was carved out exactly",
              "this way — 128 became 32 + 96, and the account size never moved."
            ],
            "type": {
              "array": [
                "u8",
                96
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ticket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "normalBall",
            "type": "bytes"
          },
          {
            "name": "bonusBall",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ticketPurchaseEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amountPaid",
            "type": "u64"
          },
          {
            "name": "ticketsBought",
            "type": "u32"
          },
          {
            "name": "ticketsData",
            "type": {
              "vec": {
                "defined": {
                  "name": "ticket"
                }
              }
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "epoch",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaultWithdrawalEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "winningsClaimedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
