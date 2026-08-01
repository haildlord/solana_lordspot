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
          "writable": true,
          "signer": true,
          "address": "AigbEGvypACrUq7hgjNwCDfd8SfcgfTH6esHu8maHysS"
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
        "Admin-only withdrawal from the vault USDC ATA to any USDC token account.",
        "Three uses: recovering devnet USDC after testing, production treasury",
        "rebalancing (CCTP bridging of the Solana/Base imbalance), and emergency",
        "evacuation of funds.",
        "",
        "Deliberately NOT gated on is_lords_pot_paused: this is the evacuation",
        "lever — it must keep working mid-incident, precisely when everything",
        "else (purchases, claims) is frozen by the pause."
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
          "name": "admin",
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
