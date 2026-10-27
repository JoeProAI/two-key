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
/** Conversion statuses. Source: GET /api/v1/fx/conversions/{conversion_id} and GET /api/v1/fx/conversions
 *  (https://www.airwallex.com/docs/api/transactional_fx/conversion/retrieve.md, .../conversion/list.md, checked Oct 13, 2026):
 *  "Can be one of SCHEDULED, CANCELLED, OVERDUE, SETTLED". */
export type ConversionStatus = "SCHEDULED" | "OVERDUE" | "CANCELLED" | "SETTLED";
/** Subset of the conversion object. The id field is `conversion_id` (uuid), per the same docs. */
export interface Conversion {
  conversion_id: string;
  request_id: string;
  buy_currency: string;
  sell_currency: string;
  buy_amount: number;
  sell_amount: number;
  quote_id?: string;
  status: ConversionStatus;
  created_at?: string;
}

/** List responses. GET /api/v1/transfers returns { items, page_after, page_before }
 *  (docs/api/payouts/transfers/list.md). GET /api/v1/fx/conversions returns { has_more, items }
 *  (docs/api/transactional_fx/conversion/list.md). Both wrap results in `items`. */
export interface TransferList { items?: Transfer[]; page_after?: string | null; page_before?: string | null }
export interface ConversionList { items?: Conversion[]; has_more?: boolean }

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

/** Documented error codes we branch on.
 *  Error body: { code, source, message, details } (docs/api/errors.md).
 *  POST /api/v1/transfers/create: 400 `request_id_duplicate`, 400 `quote_expired`, 409 `request_pending`
 *  (docs/api/payouts/transfers/create.md, "Errors").
 *  POST /api/v1/fx/conversions/create: 400 `expired_quote`, `invalid_quote_id`, `invalid_argument`, ... The docs say a reused
 *  request_id "will be rejected" but list no dedicated code (docs/api/transactional_fx/conversion/create.md). */
export const AWX_ERR = {
  transferDuplicate: "request_id_duplicate",
  transferPending: "request_pending",
  transferQuoteExpired: "quote_expired",
  conversionQuoteExpired: "expired_quote",
  balanceInsufficient: "balance_insufficient",
} as const;

export class AirwallexError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    /** API `message` field. Kept off `Error.message` so a log of the exception stays free of echoed request data. */
    public apiMessage?: string,
    /** API `source` field (a parameter path, not a value). */
    public source?: string,
    /** Parameter paths pulled out of `details`. Values are not copied. */
    public fields: string[] = [],
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
  /** GET /api/v1/fx/conversions/{conversion_id} */
  getConversion(conversionId: string): Promise<Conversion>;
  /** GET /api/v1/fx/conversions?request_id=... (list endpoint's documented request_id filter). */
  findConversionByRequestId(requestId: string): Promise<Conversion | null>;
  /** Sandbox only: POST /api/v1/simulation/transfers/{id}/transition */
  simulateTransferTransition(id: string, nextStatus: TransferStatus, failureType?: string): Promise<Transfer>;
}
