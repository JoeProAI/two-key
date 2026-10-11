// Shapes trimmed to the fields Two-Key uses. Field names are copied from the
// Airwallex API reference (https://www.airwallex.com/docs/api), checked Oct 11, 2026.

/** Transfer statuses we act on. Source: docs/payouts/transfers/create-a-transfer/transfer-statuses
 *  and the simulation endpoint, which accepts OVERDUE, PROCESSING, SENT, PAID, FAILED, CANCELLED. */
export type TransferStatus =
  | "SCHEDULED"
  | "OVERDUE"
  | "PROCESSING"
  | "SENT"
  | "PAID"
  | "FAILED"
  | "CANCELLED";

/** Subset of GET /api/v1/transfers/{id} response. */
export interface Transfer {
  id: string;
  request_id: string;
  status: TransferStatus;
  transfer_amount: number; // API returns a number in major units
  transfer_currency: string;
  source_currency?: string;
  beneficiary_id?: string;
  reference?: string;
  failure_reason?: { code?: string; description?: string } | string;
  created_at: string;
}

/** Body of POST /api/v1/transfers/create (subset). Amounts are strings in major units, per the doc example ("transfer_amount": "50"). */
export interface CreateTransferBody {
  request_id: string;
  beneficiary_id: string;
  transfer_amount: string;
  transfer_currency: string;
  transfer_method: "LOCAL" | "SWIFT";
  source_currency?: string;
  reference: string;
  reason: string;
}

/** Item of GET /api/v1/balances/current. */
export interface Balance {
  currency: string;
  available_amount: number;
  pending_amount?: number;
  reserved_amount?: number;
  total_amount?: number;
}

/** POST /api/v1/fx/quotes/create. validity options: MIN_1, MIN_15, MIN_30, HR_1, HR_4, HR_8, HR_24.
 *  buy_amount must be blank if sell_amount is set, and vice versa. */
export type QuoteValidity = "MIN_1" | "MIN_15" | "MIN_30" | "HR_1" | "HR_4" | "HR_8" | "HR_24";
export interface CreateQuoteBody {
  buy_currency: string;
  sell_currency: string;
  buy_amount?: number;
  sell_amount?: number;
  validity: QuoteValidity;
}
export interface Quote {
  quote_id: string;
  buy_currency: string;
  sell_currency: string;
  buy_amount: number;
  sell_amount: number;
  client_rate: number;
  validity: QuoteValidity;
  valid_from_at: string;
  valid_to_at: string;
}

/** POST /api/v1/fx/conversions/create. quote_id optional; without it the conversion runs at market rate. */
export interface CreateConversionBody {
  request_id: string;
  buy_currency: string;
  sell_currency: string;
  buy_amount?: string;
  sell_amount?: string;
  quote_id?: string;
}
export interface Conversion {
  conversion_id: string;
  request_id: string;
  buy_currency: string;
  sell_currency: string;
  buy_amount: number;
  sell_amount: number;
  quote_id?: string;
  status: string;
}

/** Webhook Event object. Source: docs/developer-tools/webhooks/listen-for-webhook-events
 *  Fields: id, name, account_id, org_id, data.object, created_at, version. */
export interface WebhookEvent<T = unknown> {
  id: string;
  name: string;
  account_id?: string;
  org_id?: string;
  data: { object: T };
  created_at: string;
  version?: string;
}

export class AirwallexError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export interface AirwallexClient {
  readonly mode: "mock" | "live";
  getTransfer(id: string): Promise<Transfer>;
  findTransferByRequestId(requestId: string): Promise<Transfer | null>;
  createTransfer(body: CreateTransferBody): Promise<Transfer>;
  getBalances(): Promise<Balance[]>;
  createQuote(body: CreateQuoteBody): Promise<Quote>;
  createConversion(body: CreateConversionBody): Promise<Conversion>;
  /** Sandbox only: POST /api/v1/simulation/transfers/{id}/transition */
  simulateTransferTransition(id: string, nextStatus: TransferStatus, failureType?: string): Promise<Transfer>;
}
