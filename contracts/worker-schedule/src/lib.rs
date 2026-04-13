#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};

// ─── Enums ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum WorkPayStatus {
    Pending,
    Done,
    Failed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ScheduleStatus {
    Active,
    Cancelled,
    Completed,
}

// ─── Structs ──────────────────────────────────────────────────────────────────

/// Input struct for batch payment creation inside create_schedule.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PaymentInput {
    /// UUID string assigned by the caller.
    pub id: String,
    pub day_index: u32,
    pub hour_index: u32,
    /// Human-readable label, e.g. "Day 1 · Hr 3".
    pub label: String,
    /// ISO date string "YYYY-MM-DD".
    pub date: String,
    /// Unix timestamp (seconds) — when to execute this payment.
    pub pay_at: u64,
    /// Amount in 7-decimal fixed point (e.g. 10 XLM = 100_000_000).
    pub amount: i128,
}

/// An on-chain record for a single scheduled hourly payment.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ScheduledPayment {
    /// UUID string matching the caller's local payment ID.
    pub id: String,
    pub schedule_id: u64,
    pub day_index: u32,
    pub hour_index: u32,
    pub label: String,
    pub date: String,
    pub pay_at: u64,
    pub amount: i128,
    pub status: WorkPayStatus,
    /// Transaction hash on Stellar; empty string when not yet executed.
    pub tx_hash: String,
    /// Error message if execution failed; empty string on success.
    pub error: String,
    /// Ledger timestamp when execution was attempted; 0 if not executed.
    pub executed_at: u64,
}

/// Header record for a worker's payment schedule.
#[contracttype]
#[derive(Clone, Debug)]
pub struct WorkerSchedule {
    pub id: u64,
    pub worker_name: String,
    pub worker_address: Address,
    /// Hourly rate in 7-decimal fixed point.
    /// Set to 0 when using USD-budget mode (hourly_usd_budget > 0).
    pub hourly_rate: i128,
    /// USD budget per hour in 7-decimal fixed point.
    /// Agent queries live XLM/USD price at payment time.
    /// Set to 0 when using direct-rate mode (hourly_rate > 0).
    pub hourly_usd_budget: i128,
    /// "XLM" or "USDC".
    pub asset: String,
    /// When the shift starts each day, e.g. "09:00".
    pub work_start_time: String,
    pub status: ScheduleStatus,
    pub created_at: u64,
    pub payment_count: u32,
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

/// Composite key for a single payment entry.
#[contracttype]
#[derive(Clone)]
pub struct PaymentKey {
    pub owner: Address,
    pub schedule_id: u64,
    /// UUID string
    pub payment_id: String,
}

/// Composite key for per-schedule collections (payment ID list, next-pay counter).
#[contracttype]
#[derive(Clone)]
pub struct ScheduleKey {
    pub owner: Address,
    pub schedule_id: u64,
}

#[contracttype]
pub enum DataKey {
    /// u64 — next schedule ID counter (per caller).
    NextId(Address),
    /// WorkerSchedule — keyed by (caller, schedule_id).
    Schedule(Address, u64),
    /// Vec<u64> — list of schedule IDs for a caller.
    ScheduleIds(Address),
    /// ScheduledPayment — keyed by composite PaymentKey.
    Payment(PaymentKey),
    /// Vec<String> — list of UUID payment IDs for a (caller, schedule).
    PaymentIds(ScheduleKey),
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct WorkerScheduleContract;

#[contractimpl]
impl WorkerScheduleContract {
    /// Create a new worker schedule together with all its scheduled payments
    /// in a single transaction.  Returns the new schedule's on-chain ID.
    pub fn create_schedule(
        env: Env,
        caller: Address,
        worker_name: String,
        worker_address: Address,
        hourly_rate: i128,
        hourly_usd_budget: i128,
        asset: String,
        work_start_time: String,
        payments: Vec<PaymentInput>,
    ) -> u64 {
        caller.require_auth();

        let sid: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextId(caller.clone()))
            .unwrap_or(1u64);

        let payment_count = payments.len() as u32;

        let schedule = WorkerSchedule {
            id: sid,
            worker_name,
            worker_address,
            hourly_rate,
            hourly_usd_budget,
            asset,
            work_start_time,
            status: ScheduleStatus::Active,
            created_at: env.ledger().timestamp(),
            payment_count,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Schedule(caller.clone(), sid), &schedule);

        // Update schedule ID list
        let mut sids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ScheduleIds(caller.clone()))
            .unwrap_or(Vec::new(&env));
        sids.push_back(sid);
        env.storage()
            .persistent()
            .set(&DataKey::ScheduleIds(caller.clone()), &sids);

        // Advance counter
        env.storage()
            .persistent()
            .set(&DataKey::NextId(caller.clone()), &(sid + 1));

        // Store each payment
        let mut pids: Vec<String> = Vec::new(&env);
        for input in payments.iter() {
            let payment = ScheduledPayment {
                id: input.id.clone(),
                schedule_id: sid,
                day_index: input.day_index,
                hour_index: input.hour_index,
                label: input.label.clone(),
                date: input.date.clone(),
                pay_at: input.pay_at,
                amount: input.amount,
                status: WorkPayStatus::Pending,
                tx_hash: String::from_str(&env, ""),
                error: String::from_str(&env, ""),
                executed_at: 0,
            };
            let pkey = PaymentKey {
                owner: caller.clone(),
                schedule_id: sid,
                payment_id: input.id.clone(),
            };
            env.storage().persistent().set(&DataKey::Payment(pkey), &payment);
            pids.push_back(input.id.clone());
        }

        let skey = ScheduleKey { owner: caller.clone(), schedule_id: sid };
        env.storage()
            .persistent()
            .set(&DataKey::PaymentIds(skey), &pids);

        env.events().publish((symbol_short!("ws_add"),), sid);
        sid
    }

    /// Update a payment's execution result.  Called by the agent server after
    /// each hourly payment attempt (success or failure).
    pub fn set_payment_status(
        env: Env,
        caller: Address,
        schedule_id: u64,
        payment_id: String,
        status: WorkPayStatus,
        tx_hash: String,
        error: String,
    ) {
        caller.require_auth();

        let pkey = PaymentKey {
            owner: caller.clone(),
            schedule_id,
            payment_id,
        };

        let mut payment: ScheduledPayment = env
            .storage()
            .persistent()
            .get(&DataKey::Payment(pkey.clone()))
            .expect("payment not found");

        payment.status = status;
        payment.tx_hash = tx_hash;
        payment.error = error;
        payment.executed_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Payment(pkey), &payment);
    }

    /// Cancel a schedule.  All pending payments are also marked Cancelled.
    pub fn cancel_schedule(env: Env, caller: Address, schedule_id: u64) {
        caller.require_auth();

        let mut schedule: WorkerSchedule = env
            .storage()
            .persistent()
            .get(&DataKey::Schedule(caller.clone(), schedule_id))
            .expect("schedule not found");

        schedule.status = ScheduleStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Schedule(caller.clone(), schedule_id), &schedule);

        let skey = ScheduleKey { owner: caller.clone(), schedule_id };
        let pids: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::PaymentIds(skey.clone()))
            .unwrap_or(Vec::new(&env));

        for pid in pids.iter() {
            let pkey = PaymentKey {
                owner: caller.clone(),
                schedule_id,
                payment_id: pid.clone(),
            };
            if let Some(mut pay) = env
                .storage()
                .persistent()
                .get::<DataKey, ScheduledPayment>(&DataKey::Payment(pkey.clone()))
            {
                if pay.status == WorkPayStatus::Pending {
                    pay.status = WorkPayStatus::Cancelled;
                    env.storage()
                        .persistent()
                        .set(&DataKey::Payment(pkey), &pay);
                }
            }
        }

        env.events().publish((symbol_short!("ws_del"),), schedule_id);
    }

    // ─── Read-only ────────────────────────────────────────────────────────────

    pub fn get_schedule(env: Env, caller: Address, schedule_id: u64) -> WorkerSchedule {
        env.storage()
            .persistent()
            .get(&DataKey::Schedule(caller, schedule_id))
            .expect("schedule not found")
    }

    pub fn get_all_schedules(env: Env, caller: Address) -> Vec<WorkerSchedule> {
        let sids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ScheduleIds(caller.clone()))
            .unwrap_or(Vec::new(&env));

        let mut schedules: Vec<WorkerSchedule> = Vec::new(&env);
        for sid in sids.iter() {
            if let Some(s) = env
                .storage()
                .persistent()
                .get(&DataKey::Schedule(caller.clone(), sid))
            {
                schedules.push_back(s);
            }
        }
        schedules
    }

    pub fn get_payments(env: Env, caller: Address, schedule_id: u64) -> Vec<ScheduledPayment> {
        let skey = ScheduleKey { owner: caller.clone(), schedule_id };
        let pids: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::PaymentIds(skey))
            .unwrap_or(Vec::new(&env));

        let mut payments: Vec<ScheduledPayment> = Vec::new(&env);
        for pid in pids.iter() {
            let pkey = PaymentKey {
                owner: caller.clone(),
                schedule_id,
                payment_id: pid.clone(),
            };
            if let Some(p) = env
                .storage()
                .persistent()
                .get(&DataKey::Payment(pkey))
            {
                payments.push_back(p);
            }
        }
        payments
    }

    /// Returns only pending payments for a schedule.
    /// Used by the agent server's reminder job to find due payments.
    pub fn get_pending_payments(
        env: Env,
        caller: Address,
        schedule_id: u64,
    ) -> Vec<ScheduledPayment> {
        let skey = ScheduleKey { owner: caller.clone(), schedule_id };
        let pids: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::PaymentIds(skey))
            .unwrap_or(Vec::new(&env));

        let mut pending: Vec<ScheduledPayment> = Vec::new(&env);
        for pid in pids.iter() {
            let pkey = PaymentKey {
                owner: caller.clone(),
                schedule_id,
                payment_id: pid.clone(),
            };
            if let Some(p) = env
                .storage()
                .persistent()
                .get::<DataKey, ScheduledPayment>(&DataKey::Payment(pkey))
            {
                if p.status == WorkPayStatus::Pending {
                    pending.push_back(p);
                }
            }
        }
        pending
    }
}
