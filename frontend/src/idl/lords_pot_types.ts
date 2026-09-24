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
          "writable": true,
          "signer": true
        },
        {
          "name": "admin",
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
        "Hand the admin role to a new key (pause/resume/epoch/claim-signing/config)."
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
          "writable": true,
          "signer": true
        },
        {
          "name": "newTreasury",
          "docs": [
            "Signs to prove the key is real and controlled before the vault is handed to it."
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
          },
          {
            "name": "reserved",
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
