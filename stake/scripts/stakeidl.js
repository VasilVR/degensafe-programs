export default {
  address: "4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva",
  metadata: {
    name: "stake_program",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Created with Anchor"
  },
  instructions: [
    {
      name: "create_pool",
      discriminator: [
        233,
        146,
        209,
        142,
        207,
        104,
        64,
        188
      ],
      accounts: [
        {
          name: "pool",
          docs: [
            "Pool account PDA, auto-created if doesn't exist"
          ],
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  115,
                  116,
                  97,
                  107,
                  105,
                  110,
                  103,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                kind: "account",
                path: "token_mint"
              }
            ]
          }
        },
        {
          name: "token_mint",
          docs: [
            "Token mint for which the pool is created"
          ]
        },
        {
          name: "reward_mint"
        },
        {
          name: "reward_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "reward_mint"
              }
            ]
          }
        },
        {
          name: "pool_vault",
          docs: [
            "Pool vault PDA for user stakes (new)"
          ],
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "token_mint"
              }
            ]
          }
        },
        {
          name: "admin",
          docs: [
            "Admin of the program, used as payer and default owner"
          ],
          writable: true,
          signer: true
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          name: "rent",
          address: "SysvarRent111111111111111111111111111111111"
        }
      ],
      args: [
        {
          name: "maybe_owner",
          type: {
            option: "pubkey"
          }
        },
        {
          name: "reward_percentage",
          type: "u64"
        }
      ]
    },
    {
      name: "deposit_reward",
      discriminator: [
        245,
        216,
        9,
        179,
        237,
        49,
        165,
        181
      ],
      accounts: [
        {
          name: "pool",
          writable: true
        },
        {
          name: "admin",
          docs: [
            "Admin signs (must be pool.owner)"
          ],
          signer: true
        },
        {
          name: "admin_reward_account",
          writable: true
        },
        {
          name: "reward_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "pool.reward_mint",
                account: "Pool"
              }
            ]
          }
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        }
      ]
    },
    {
      name: "deposit_stake",
      discriminator: [
        160,
        167,
        9,
        220,
        74,
        243,
        228,
        43
      ],
      accounts: [
        {
          name: "pool",
          docs: [
            "The staking pool"
          ],
          writable: true
        },
        {
          name: "user_stake",
          docs: [
            "PDA to track this user's stake in the pool"
          ],
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                kind: "account",
                path: "pool"
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "user",
          docs: [
            "The user who is staking"
          ],
          writable: true,
          signer: true
        },
        {
          name: "user_token_account",
          docs: [
            "User's token account to transfer tokens from"
          ],
          writable: true
        },
        {
          name: "pool_vault",
          docs: [
            "The pool's vault (single vault for all users)"
          ],
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "pool.token_mint",
                account: "Pool"
              }
            ]
          }
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "rent",
          address: "SysvarRent111111111111111111111111111111111"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        }
      ]
    },
    {
      name: "get_pool_info",
      discriminator: [
        9,
        48,
        220,
        101,
        22,
        240,
        78,
        200
      ],
      accounts: [
        {
          name: "pool"
        }
      ],
      args: [],
      returns: {
        defined: {
          name: "PoolData"
        }
      }
    },
    {
      name: "get_user_stake_info",
      discriminator: [
        47,
        172,
        23,
        68,
        32,
        171,
        214,
        144
      ],
      accounts: [
        {
          name: "user_stake"
        },
        {
          name: "pool"
        }
      ],
      args: [],
      returns: {
        defined: {
          name: "UserStakeData"
        }
      }
    },
    {
      name: "get_user_stake_with_reward",
      discriminator: [
        121,
        3,
        252,
        75,
        134,
        39,
        105,
        100
      ],
      accounts: [
        {
          name: "user_stake"
        },
        {
          name: "pool"
        }
      ],
      args: [],
      returns: {
        defined: {
          name: "UserStakeInfoWithReward"
        }
      }
    },
    {
      name: "set_staking_active",
      discriminator: [
        80,
        15,
        62,
        72,
        110,
        214,
        100,
        89
      ],
      accounts: [
        {
          name: "pool",
          writable: true
        },
        {
          name: "admin",
          signer: true
        }
      ],
      args: [
        {
          name: "active",
          type: "bool"
        }
      ]
    },
    {
      name: "update_reward_mint",
      discriminator: [
        43,
        12,
        215,
        65,
        55,
        123,
        34,
        23
      ],
      accounts: [
        {
          name: "pool",
          writable: true
        },
        {
          name: "admin",
          writable: true,
          signer: true
        },
        {
          name: "new_reward_mint",
          docs: [
            "The new reward mint account"
          ]
        },
        {
          name: "reward_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "new_reward_mint"
              }
            ]
          }
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "rent",
          address: "SysvarRent111111111111111111111111111111111"
        }
      ],
      args: []
    },
    {
      name: "update_reward_percentage",
      discriminator: [
        224,
        241,
        241,
        192,
        166,
        176,
        69,
        175
      ],
      accounts: [
        {
          name: "pool",
          writable: true
        },
        {
          name: "admin",
          signer: true
        }
      ],
      args: [
        {
          name: "new_percentage",
          type: "u64"
        }
      ]
    },
    {
      name: "withdraw_reward",
      discriminator: [
        191,
        187,
        176,
        137,
        9,
        25,
        187,
        244
      ],
      accounts: [
        {
          name: "pool",
          writable: true
        },
        {
          name: "admin",
          docs: [
            "Admin signer (must be pool owner)"
          ],
          signer: true
        },
        {
          name: "admin_reward_account",
          docs: [
            "Admin's token account to receive rewards"
          ],
          writable: true
        },
        {
          name: "reward_vault",
          docs: [
            "Pool's reward vault"
          ],
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "pool.reward_mint",
                account: "Pool"
              }
            ]
          }
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        }
      ]
    },
    {
      name: "withdraw_stake",
      discriminator: [
        153,
        8,
        22,
        138,
        105,
        176,
        87,
        66
      ],
      accounts: [
        {
          name: "pool",
          writable: true
        },
        {
          name: "user_stake",
          writable: true
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "user_token_account",
          writable: true
        },
        {
          name: "user_reward_account",
          writable: true
        },
        {
          name: "pool_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "pool.token_mint",
                account: "Pool"
              }
            ]
          }
        },
        {
          name: "reward_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "pool.reward_mint",
                account: "Pool"
              }
            ]
          }
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        }
      ]
    }
  ],
  accounts: [
    {
      name: "Pool",
      discriminator: [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      name: "UserStake",
      discriminator: [
        102,
        53,
        163,
        107,
        9,
        138,
        87,
        153
      ]
    }
  ],
  errors: [
    {
      code: 6000,
      name: "Unauthorized",
      msg: "Unauthorized: Only pool owner can perform this action"
    },
    {
      code: 6001,
      name: "StakingDisabled",
      msg: "Staking is currently disabled for this pool"
    },
    {
      code: 6002,
      name: "InsufficientRewardVault",
      msg: "Insufficient tokens in reward vault to pay rewards"
    }
  ],
  types: [
    {
      name: "Pool",
      type: {
        kind: "struct",
        fields: [
          {
            name: "token_mint",
            type: "pubkey"
          },
          {
            name: "reward_mint",
            type: "pubkey"
          },
          {
            name: "reward_vault",
            type: "pubkey"
          },
          {
            name: "owner",
            type: "pubkey"
          },
          {
            name: "total_staked",
            type: "u64"
          },
          {
            name: "reward_percentage",
            type: "u64"
          },
          {
            name: "bump",
            type: "u8"
          },
          {
            name: "is_active",
            type: "bool"
          }
        ]
      }
    },
    {
      name: "PoolData",
      type: {
        kind: "struct",
        fields: [
          {
            name: "token_mint",
            type: "pubkey"
          },
          {
            name: "reward_mint",
            type: "pubkey"
          },
          {
            name: "reward_vault",
            type: "pubkey"
          },
          {
            name: "owner",
            type: "pubkey"
          },
          {
            name: "total_staked",
            type: "u64"
          },
          {
            name: "reward_percentage",
            type: "u64"
          },
          {
            name: "bump",
            type: "u8"
          },
          {
            name: "is_active",
            type: "bool"
          }
        ]
      }
    },
    {
      name: "UserStake",
      type: {
        kind: "struct",
        fields: [
          {
            name: "owner",
            type: "pubkey"
          },
          {
            name: "pool",
            type: "pubkey"
          },
          {
            name: "amount",
            type: "u64"
          },
          {
            name: "last_staked_time",
            type: "i64"
          },
          {
            name: "total_earned",
            type: "u64"
          },
          {
            name: "unclaimed",
            type: "u64"
          },
          {
            name: "bump",
            type: "u8"
          }
        ]
      }
    },
    {
      name: "UserStakeData",
      type: {
        kind: "struct",
        fields: [
          {
            name: "owner",
            type: "pubkey"
          },
          {
            name: "pool",
            type: "pubkey"
          },
          {
            name: "amount",
            type: "u64"
          },
          {
            name: "total_earned",
            type: "u64"
          },
          {
            name: "last_staked_time",
            type: "i64"
          },
          {
            name: "unclaimed",
            type: "u64"
          },
          {
            name: "bump",
            type: "u8"
          }
        ]
      }
    },
    {
      name: "UserStakeInfoWithReward",
      type: {
        kind: "struct",
        fields: [
          {
            name: "owner",
            type: "pubkey"
          },
          {
            name: "pool",
            type: "pubkey"
          },
          {
            name: "amount",
            type: "u64"
          },
          {
            name: "total_earned",
            type: "u64"
          },
          {
            name: "last_staked_time",
            type: "i64"
          },
          {
            name: "unclaimed",
            type: "u64"
          },
          {
            name: "bump",
            type: "u8"
          },
          {
            name: "pending_reward",
            type: "u64"
          }
        ]
      }
    }
  ]
}