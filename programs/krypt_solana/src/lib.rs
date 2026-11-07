// Krypt on Solana: the spending gate as a policy program.
//
// Design notes, read before editing.
//
// 1. The vault is a PDA. It has no private key, so nobody can sign a direct
//    transfer from it. The only way lamports leave is through this program's
//    code, which checks the caller and the rules first. This replaces NEAR's
//    scoped FunctionCall key: on Solana the wall lives in the program.
// 2. Policy refusals never fail the transaction. A refused request still
//    writes a receipt, because the refusal is the evidence. The transaction
//    only errors on structural problems: wrong signer, wrong vault, overflow.
// 3. Every decision writes a receipt account: settled, queued, refused,
//    approved, owner-refused, each with a plain-sentence reason.
// 4. simulate runs the identical decision code and writes nothing. It answers
//    through program logs, read via simulateTransaction on the client.
// 5. The vault fails closed. Until set_rules runs, every request is refused.

use anchor_lang::prelude::*;

// In the playground, keep the declare_id line the template generated.
declare_id!("7VCNmeFyt1oRm8u2GxKDmJPnXjM7hmM5Vq66SxKYcX7B");

pub const VAULT_SEED: &[u8] = b"vault";
pub const RECEIPT_SEED: &[u8] = b"receipt";
pub const MAX_PAYEES: usize = 4;
pub const PURPOSE_LEN: usize = 64;
pub const REASON_LEN: usize = 128;

// Receipt status codes, mirrored in the TypeScript client.
pub const ST_SETTLED: u8 = 0;
pub const ST_QUEUED: u8 = 1;
pub const ST_REFUSED: u8 = 2;
pub const ST_APPROVED: u8 = 3;
pub const ST_OWNER_REFUSED: u8 = 4;

// Account sizes: 8 byte discriminator plus the struct.
pub const VAULT_LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + (32 * MAX_PAYEES) + 1 + 1 + 8 + 8 + 1;
pub const RECEIPT_LEN: usize = 8 + 32 + 8 + 32 + 8 + 1 + PURPOSE_LEN + REASON_LEN + 8 + 1;

#[program]
pub mod krypt_solana {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.agent = Pubkey::default();
        vault.cap = 0;
        vault.auto = 0;
        vault.budget = 0;
        vault.spent = 0;
        vault.payees = [Pubkey::default(); MAX_PAYEES];
        vault.payee_count = 0;
        vault.rules_set = false;
        vault.receipt_counter = 0;
        vault.created_at = Clock::get()?.unix_timestamp;
        vault.bump = ctx.bumps.vault;
        msg!("vault initialized, failing closed until rules are set");
        Ok(())
    }

    pub fn set_rules(ctx: Context<OwnerOp>, cap: u64, auto: u64, budget: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(auto <= cap, KryptError::AutoAboveCap);
        vault.cap = cap;
        vault.auto = auto;
        vault.budget = budget;
        vault.rules_set = true;
        msg!("rules set: cap {}, auto-approve line {}, budget {}", cap, auto, budget);
        Ok(())
    }

    pub fn register_agent(ctx: Context<OwnerOp>, agent: Pubkey) -> Result<()> {
        ctx.accounts.vault.agent = agent;
        msg!("agent registered");
        Ok(())
    }

    pub fn revoke_agent(ctx: Context<OwnerOp>) -> Result<()> {
        ctx.accounts.vault.agent = Pubkey::default();
        msg!("agent revoked, the vault now refuses every request");
        Ok(())
    }

    pub fn add_payee(ctx: Context<OwnerOp>, payee: Pubkey) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.has_payee(&payee), KryptError::PayeeExists);
        require!((vault.payee_count as usize) < MAX_PAYEES, KryptError::PayeeListFull);
        let idx = vault.payee_count as usize;
        vault.payees[idx] = payee;
        vault.payee_count += 1;
        Ok(())
    }

    pub fn remove_payee(ctx: Context<OwnerOp>, payee: Pubkey) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let count = vault.payee_count as usize;
        let idx = vault.payees[..count]
            .iter()
            .position(|p| p == &payee)
            .ok_or(KryptError::PayeeMissing)?;
        // Shift the tail left so the list stays contiguous.
        let mut i = idx;
        while i + 1 < count {
            vault.payees[i] = vault.payees[i + 1];
            i += 1;
        }
        vault.payees[i] = Pubkey::default();
        vault.payee_count -= 1;
        Ok(())
    }

    pub fn request_spend(ctx: Context<RequestSpend>, amount: u64, purpose: String) -> Result<()> {
        let rent_min = Rent::get()?.minimum_balance(VAULT_LEN);
        let payee_key = ctx.accounts.payee.key();
        let vault_lamports = ctx.accounts.vault.to_account_info().lamports();

        let (verdict, reason) = {
            let vault = &ctx.accounts.vault;
            decide(vault, &payee_key, amount, vault_lamports, rent_min)
        };

        let receipt = &mut ctx.accounts.receipt;
        receipt.vault = ctx.accounts.vault.key();
        receipt.counter = ctx.accounts.vault.receipt_counter;
        receipt.payee = payee_key;
        receipt.amount = amount;
        pack_str(&purpose, &mut receipt.purpose);
        receipt.ts = Clock::get()?.unix_timestamp;
        receipt.bump = ctx.bumps.receipt;

        match verdict {
            Verdict::Settle => {
                pay_from_vault(
                    &ctx.accounts.vault.to_account_info(),
                    &ctx.accounts.payee.to_account_info(),
                    amount,
                )?;
                let vault = &mut ctx.accounts.vault;
                vault.spent = vault
                    .spent
                    .checked_add(amount)
                    .ok_or(KryptError::Overflow)?;
                vault.receipt_counter += 1;
                receipt.status = ST_SETTLED;
                pack_str(reason, &mut receipt.reason);
                msg!("SETTLED {} lamports to {}: {}", amount, payee_key, reason);
            }
            Verdict::Queue => {
                let vault = &mut ctx.accounts.vault;
                vault.receipt_counter += 1;
                receipt.status = ST_QUEUED;
                pack_str(reason, &mut receipt.reason);
                msg!("QUEUED {} lamports for owner approval: {}", amount, reason);
            }
            Verdict::Refuse => {
                let vault = &mut ctx.accounts.vault;
                vault.receipt_counter += 1;
                receipt.status = ST_REFUSED;
                pack_str(reason, &mut receipt.reason);
                msg!("REFUSED {} lamports to {}: {}", amount, payee_key, reason);
            }
        }
        Ok(())
    }

    pub fn approve_spend(ctx: Context<OwnerReceipt>) -> Result<()> {
        let receipt = &mut ctx.accounts.receipt;
        require!(receipt.status == ST_QUEUED, KryptError::NotQueued);

        let rent_min = Rent::get()?.minimum_balance(VAULT_LEN);
        let vault_lamports = ctx.accounts.vault.to_account_info().lamports();
        let (ok, reason) = {
            let vault = &ctx.accounts.vault;
            decide_approval(vault, &receipt.payee, receipt.amount, vault_lamports, rent_min)
        };

        if ok {
            pay_from_vault(
                &ctx.accounts.vault.to_account_info(),
                &ctx.accounts.payee.to_account_info(),
                receipt.amount,
            )?;
            let vault = &mut ctx.accounts.vault;
            vault.spent = vault
                .spent
                .checked_add(receipt.amount)
                .ok_or(KryptError::Overflow)?;
            receipt.status = ST_APPROVED;
            pack_str(reason, &mut receipt.reason);
            msg!("APPROVED {} lamports: {}", receipt.amount, reason);
        } else {
            // The rules re-checked dirty. The approval dies here, on the
            // record, and no money moves.
            receipt.status = ST_REFUSED;
            pack_str(reason, &mut receipt.reason);
            msg!("REFUSED at approval: {}", reason);
        }
        Ok(())
    }

    pub fn refuse_spend(ctx: Context<OwnerReceipt>, reason: String) -> Result<()> {
        let receipt = &mut ctx.accounts.receipt;
        require!(receipt.status == ST_QUEUED, KryptError::NotQueued);
        receipt.status = ST_OWNER_REFUSED;
        pack_str(&reason, &mut receipt.reason);
        msg!("OWNER REFUSED: {}", reason);
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let rent_min = Rent::get()?.minimum_balance(VAULT_LEN);
        let vault_info = ctx.accounts.vault.to_account_info();
        let spendable = vault_info.lamports().saturating_sub(rent_min);
        require!(amount <= spendable, KryptError::Insufficient);
        pay_from_vault(&vault_info, &ctx.accounts.owner.to_account_info(), amount)?;
        msg!("WITHDREW {} lamports to the owner", amount);
        Ok(())
    }

    // The dry mode. Identical decision code, zero writes. The answer goes out
    // through program logs; the client reads it from a simulated transaction.
    pub fn simulate(ctx: Context<SimulateOp>, amount: u64, purpose: String) -> Result<()> {
        let rent_min = Rent::get()?.minimum_balance(VAULT_LEN);
        let vault_lamports = ctx.accounts.vault.to_account_info().lamports();
        let payee_key = ctx.accounts.payee.key();
        let (verdict, reason) = decide(
            &ctx.accounts.vault,
            &payee_key,
            amount,
            vault_lamports,
            rent_min,
        );
        let word = match verdict {
            Verdict::Settle => "SETTLED",
            Verdict::Queue => "QUEUED",
            Verdict::Refuse => "REFUSED",
        };
        msg!("SIMULATE would-be status {} for {} lamports, purpose \"{}\": {}", word, amount, purpose, reason);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub cap: u64,
    pub auto: u64,
    pub budget: u64,
    pub spent: u64,
    pub payees: [Pubkey; MAX_PAYEES],
    pub payee_count: u8,
    pub rules_set: bool,
    pub receipt_counter: u64,
    pub created_at: i64,
    pub bump: u8,
}

impl Vault {
    pub fn has_payee(&self, payee: &Pubkey) -> bool {
        self.payees[..self.payee_count as usize]
            .iter()
            .any(|p| p == payee)
    }
}

#[account]
pub struct Receipt {
    pub vault: Pubkey,
    pub counter: u64,
    pub payee: Pubkey,
    pub amount: u64,
    pub status: u8,
    pub purpose: [u8; PURPOSE_LEN],
    pub reason: [u8; REASON_LEN],
    pub ts: i64,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// The decision, one place, shared by request_spend and simulate
// ---------------------------------------------------------------------------

pub enum Verdict {
    Settle,
    Queue,
    Refuse,
}

fn decide(
    vault: &Vault,
    payee: &Pubkey,
    amount: u64,
    vault_lamports: u64,
    rent_min: u64,
) -> (Verdict, &'static str) {
    if !vault.rules_set {
        return (Verdict::Refuse, "no rules are set, the vault fails closed");
    }
    if amount == 0 {
        return (Verdict::Refuse, "the amount is zero");
    }
    if payee == &vault.key_self() {
        return (Verdict::Refuse, "the payee is the vault itself");
    }
    if !vault.has_payee(payee) {
        return (Verdict::Refuse, "the payee is not on the allowlist");
    }
    if amount > vault.cap {
        return (Verdict::Refuse, "the amount is above the per-purchase cap");
    }
    match vault.spent.checked_add(amount) {
        None => return (Verdict::Refuse, "arithmetic overflow in the budget check"),
        Some(total) => {
            if total > vault.budget {
                return (Verdict::Refuse, "the amount exceeds the remaining budget");
            }
        }
    }
    let spendable = vault_lamports.saturating_sub(rent_min);
    if spendable < amount {
        return (Verdict::Refuse, "the spendable balance is below the amount");
    }
    if amount > vault.auto {
        return (
            Verdict::Queue,
            "the amount is above the auto-approve line, queued for the owner",
        );
    }
    (
        Verdict::Settle,
        "all rules passed and the amount is within the auto-approve line",
    )
}

// Approval re-runs every check except the auto-approve line, because a
// request queued under old rules must not slip through after a change.
fn decide_approval(
    vault: &Vault,
    payee: &Pubkey,
    amount: u64,
    vault_lamports: u64,
    rent_min: u64,
) -> (bool, &'static str) {
    if !vault.rules_set {
        return (false, "the rules are no longer set, the vault fails closed");
    }
    if !vault.has_payee(payee) {
        return (false, "the payee is no longer on the allowlist");
    }
    if amount > vault.cap {
        return (false, "the amount is now above the per-purchase cap");
    }
    match vault.spent.checked_add(amount) {
        None => return (false, "arithmetic overflow in the budget check"),
        Some(total) => {
            if total > vault.budget {
                return (false, "the amount now exceeds the remaining budget");
            }
        }
    }
    let spendable = vault_lamports.saturating_sub(rent_min);
    if spendable < amount {
        return (false, "the spendable balance is below the amount");
    }
    (true, "the owner approved and the rules re-checked clean")
}

// The vault cannot know its own address inside its struct, so the self-pay
// guard compares against the derived address the caller supplied. Keeping a
// method here avoids threading the key through decide's signature everywhere.
impl Vault {
    // The vault's own address, derived from the owner. Used by the decision
    // code to refuse self-payments. Derivation is deterministic and cheap.
    pub fn key_self(&self) -> Pubkey {
        let (pda, _bump) =
            Pubkey::find_program_address(&[VAULT_SEED, self.owner.as_ref()], &crate::id());
        pda
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Lamports move by direct debit and credit. The vault is owned by this
// program, so the system program's Transfer cannot touch it; this is the
// standard pattern and it is safe because only the code above, after its
// checks, ever calls it.
fn pay_from_vault(vault_info: &AccountInfo, payee_info: &AccountInfo, amount: u64) -> Result<()> {
    let from = vault_info.lamports();
    require!(from >= amount, KryptError::Insufficient);
    **vault_info.try_borrow_mut_lamports()? = from - amount;
    let to = payee_info.lamports();
    **payee_info.try_borrow_mut_lamports()? = to
        .checked_add(amount)
        .ok_or(KryptError::Overflow)?;
    Ok(())
}

fn pack_str(s: &str, buf: &mut [u8]) {
    for b in buf.iter_mut() {
        *b = 0;
    }
    let bytes = s.as_bytes();
    let n = bytes.len().min(buf.len());
    buf[..n].copy_from_slice(&bytes[..n]);
}

// ---------------------------------------------------------------------------
// Instruction contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = owner,
        space = VAULT_LEN,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerOp<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ KryptError::NotOwner
    )]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RequestSpend<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        constraint = vault.agent != Pubkey::default() @ KryptError::NoAgent,
        constraint = vault.agent == agent.key() @ KryptError::NotAgent
    )]
    pub agent: Signer<'info>,
    /// CHECK: the payee. Validated against the allowlist inside decide();
    /// marked mut because a settled payment credits it.
    #[account(mut)]
    pub payee: UncheckedAccount<'info>,
    #[account(
        init,
        payer = agent,
        space = RECEIPT_LEN,
        seeds = [RECEIPT_SEED, vault.key().as_ref(), &vault.receipt_counter.to_le_bytes()],
        bump
    )]
    pub receipt: Account<'info, Receipt>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerReceipt<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ KryptError::NotOwner
    )]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
    #[account(
        mut,
        constraint = receipt.vault == vault.key() @ KryptError::WrongVault
    )]
    pub receipt: Account<'info, Receipt>,
    /// CHECK: must be the payee named in the receipt; a settled approval
    /// credits it.
    #[account(
        mut,
        constraint = payee.key() == receipt.payee @ KryptError::PayeeMismatch
    )]
    pub payee: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ KryptError::NotOwner
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct SimulateOp<'info> {
    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    /// CHECK: the hypothetical payee, validated inside decide().
    pub payee: UncheckedAccount<'info>,
}

// ---------------------------------------------------------------------------
// Errors. Structural only; policy refusals are receipts, never errors.
// ---------------------------------------------------------------------------

#[error_code]
pub enum KryptError {
    #[msg("the caller is not the vault owner")]
    NotOwner,
    #[msg("the caller is not the registered agent")]
    NotAgent,
    #[msg("no agent is registered, the vault refuses everything")]
    NoAgent,
    #[msg("the payee is already on the allowlist")]
    PayeeExists,
    #[msg("the payee allowlist is full")]
    PayeeListFull,
    #[msg("the payee is not on the allowlist")]
    PayeeMissing,
    #[msg("the receipt does not belong to this vault")]
    WrongVault,
    #[msg("the payee account does not match the receipt")]
    PayeeMismatch,
    #[msg("the receipt is not in the queued state")]
    NotQueued,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("the spendable balance is insufficient")]
    Insufficient,
    #[msg("the auto-approve line cannot exceed the cap")]
    AutoAboveCap,
}
