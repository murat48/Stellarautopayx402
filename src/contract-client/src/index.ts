import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CCNEGKPIN3D7JECQLN2VW3FOMZOSGV4OUHCMD7ZSTKOETINLLEND45J3",
  }
} as const

/**
 * Payment outcome stored on-chain
 */
export type PaymentStatus = {tag: "Success", values: void} | {tag: "Failed", values: void} | {tag: "Skipped", values: void};


/**
 * Immutable record of a payment attempt
 */
export interface PaymentRecord {
  amount: i128;
  asset: string;
  bill_id: u64;
  bill_name: string;
  error_msg: string;
  executed_at: u64;
  id: u64;
  recipient: string;
  status: PaymentStatus;
  tx_hash: string;
}

/**
 * Bill status stored on-chain
 */
export type BillStatus = {tag: "Active", values: void} | {tag: "Paused", values: void} | {tag: "Completed", values: void} | {tag: "LowBalance", values: void};

/**
 * Payment frequency
 */
export type Frequency = {tag: "Weekly", values: void} | {tag: "Biweekly", values: void} | {tag: "Monthly", values: void} | {tag: "Quarterly", values: void} | {tag: "None", values: void};

/**
 * Bill type
 */
export type BillType = {tag: "Recurring", values: void} | {tag: "OneTime", values: void};


/**
 * A single bill/payment instruction
 */
export interface Bill {
  amount: i128;
  asset: string;
  bill_type: BillType;
  created_at: u64;
  /**
 * For monthly/quarterly: specific day of month to pay (1-31).
 * 0 = not set (use relative scheduling).
 * If the month has fewer days than day_of_month, the frontend
 * clamps to the last day (e.g. 31 → 30 in April, 28/29 in Feb).
 */
day_of_month: u32;
  frequency: Frequency;
  id: u64;
  name: string;
  next_due: u64;
  recipient: string;
  status: BillStatus;
}

/**
 * Per-user storage keys — no global owner, each wallet has its own namespace
 */
export type DataKey = {tag: "NextId", values: readonly [string]} | {tag: "Bill", values: readonly [string, u64]} | {tag: "BillIds", values: readonly [string]} | {tag: "PaymentNextId", values: readonly [string]} | {tag: "Payment", values: readonly [string, u64]} | {tag: "PaymentIds", values: readonly [string]};

export interface Client {
  /**
   * Construct and simulate a add_bill transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Add a new bill. Any authenticated wallet can call this.
   * No initialization needed — storage is per-caller.
   */
  add_bill: ({caller, name, recipient, amount, asset, bill_type, frequency, day_of_month, next_due}: {caller: string, name: string, recipient: string, amount: i128, asset: string, bill_type: BillType, frequency: Frequency, day_of_month: u32, next_due: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Bill>>

  /**
   * Construct and simulate a pause_bill transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pause or resume a bill
   */
  pause_bill: ({caller, bill_id}: {caller: string, bill_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update bill status (called by session key in auto-pay engine)
   */
  update_status: ({caller, bill_id, status}: {caller: string, bill_id: u64, status: BillStatus}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_next_due transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the next_due date after a successful payment
   */
  update_next_due: ({caller, bill_id, new_next_due}: {caller: string, bill_id: u64, new_next_due: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a complete_bill transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mark a one-time bill as completed
   */
  complete_bill: ({caller, bill_id}: {caller: string, bill_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a delete_bill transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Delete a bill
   */
  delete_bill: ({caller, bill_id}: {caller: string, bill_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_bill transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get a single bill by caller + ID
   */
  get_bill: ({caller, bill_id}: {caller: string, bill_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Bill>>

  /**
   * Construct and simulate a get_all_bills transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get all bills for a given wallet address
   */
  get_all_bills: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Bill>>>

  /**
   * Construct and simulate a get_active_bills transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get only active bills for a given wallet (for payment engine polling)
   */
  get_active_bills: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Bill>>>

  /**
   * Construct and simulate a record_payment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Record a payment attempt (success / failed / skipped).
   * Called by the auto-pay engine after each payment attempt.
   */
  record_payment: ({caller, bill_id, bill_name, recipient, amount, asset, tx_hash, status, error_msg}: {caller: string, bill_id: u64, bill_name: string, recipient: string, amount: i128, asset: string, tx_hash: string, status: PaymentStatus, error_msg: string}, options?: MethodOptions) => Promise<AssembledTransaction<PaymentRecord>>

  /**
   * Construct and simulate a get_payment_history transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get all payment records for a wallet (newest last).
   */
  get_payment_history: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<PaymentRecord>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "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",
        "AAAAAAAAADNVcGRhdGUgdGhlIG5leHRfZHVlIGRhdGUgYWZ0ZXIgYSBzdWNjZXNzZnVsIHBheW1lbnQAAAAAD3VwZGF0ZV9uZXh0X2R1ZQAAAAADAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAAB2JpbGxfaWQAAAAABgAAAAAAAAAMbmV3X25leHRfZHVlAAAABgAAAAA=",
        "AAAAAAAAACFNYXJrIGEgb25lLXRpbWUgYmlsbCBhcyBjb21wbGV0ZWQAAAAAAAANY29tcGxldGVfYmlsbAAAAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAHYmlsbF9pZAAAAAAGAAAAAA==",
        "AAAAAAAAAA1EZWxldGUgYSBiaWxsAAAAAAAAC2RlbGV0ZV9iaWxsAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAHYmlsbF9pZAAAAAAGAAAAAA==",
        "AAAAAAAAACBHZXQgYSBzaW5nbGUgYmlsbCBieSBjYWxsZXIgKyBJRAAAAAhnZXRfYmlsbAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAHYmlsbF9pZAAAAAAGAAAAAQAAB9AAAAAEQmlsbA==",
        "AAAAAAAAAChHZXQgYWxsIGJpbGxzIGZvciBhIGdpdmVuIHdhbGxldCBhZGRyZXNzAAAADWdldF9hbGxfYmlsbHMAAAAAAAABAAAAAAAAAAZjYWxsZXIAAAAAABMAAAABAAAD6gAAB9AAAAAEQmlsbA==",
        "AAAAAAAAAEVHZXQgb25seSBhY3RpdmUgYmlsbHMgZm9yIGEgZ2l2ZW4gd2FsbGV0IChmb3IgcGF5bWVudCBlbmdpbmUgcG9sbGluZykAAAAAAAAQZ2V0X2FjdGl2ZV9iaWxscwAAAAEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAEAAAPqAAAH0AAAAARCaWxs",
        "AAAAAAAAAHBSZWNvcmQgYSBwYXltZW50IGF0dGVtcHQgKHN1Y2Nlc3MgLyBmYWlsZWQgLyBza2lwcGVkKS4KQ2FsbGVkIGJ5IHRoZSBhdXRvLXBheSBlbmdpbmUgYWZ0ZXIgZWFjaCBwYXltZW50IGF0dGVtcHQuAAAADnJlY29yZF9wYXltZW50AAAAAAAJAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAAB2JpbGxfaWQAAAAABgAAAAAAAAAJYmlsbF9uYW1lAAAAAAAAEAAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAVhc3NldAAAAAAAABAAAAAAAAAAB3R4X2hhc2gAAAAAEAAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADVBheW1lbnRTdGF0dXMAAAAAAAAAAAAACWVycm9yX21zZwAAAAAAABAAAAABAAAH0AAAAA1QYXltZW50UmVjb3JkAAAA",
        "AAAAAAAAADNHZXQgYWxsIHBheW1lbnQgcmVjb3JkcyBmb3IgYSB3YWxsZXQgKG5ld2VzdCBsYXN0KS4AAAAAE2dldF9wYXltZW50X2hpc3RvcnkAAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAQAAA+oAAAfQAAAADVBheW1lbnRSZWNvcmQAAAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    add_bill: this.txFromJSON<Bill>,
        pause_bill: this.txFromJSON<null>,
        update_status: this.txFromJSON<null>,
        update_next_due: this.txFromJSON<null>,
        complete_bill: this.txFromJSON<null>,
        delete_bill: this.txFromJSON<null>,
        get_bill: this.txFromJSON<Bill>,
        get_all_bills: this.txFromJSON<Array<Bill>>,
        get_active_bills: this.txFromJSON<Array<Bill>>,
        record_payment: this.txFromJSON<PaymentRecord>,
        get_payment_history: this.txFromJSON<Array<PaymentRecord>>
  }
}