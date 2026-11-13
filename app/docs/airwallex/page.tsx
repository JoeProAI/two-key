import { DocHead, Next, Source, Table } from "../kit";

const c = (text: string) => <code>{text}</code>;

export default function AirwallexMap() {
  return (
    <article>
      <DocHead kicker="Airwallex API map" title="Each desk step, its endpoint, the code and the test.">
        <p>
          The public desk answers every row with the mock provider (<code>lib/airwallex/mock.ts</code>). Only <code>npm run live-smoke</code> and the
          optional step in <code>npm run proof</code> call the sandbox host. Code is <code>lib/airwallex/live.ts</code> unless noted.
        </p>
      </DocHead>

      <Table
        head={["Desk step", "Endpoint", "Code", "Test"]}
        rows={[
          ["Sign in", c("POST /api/v1/authentication/login"), <>{c("createLiveClient")} → {c("login")}, {c("authenticate")}</>, <>{c("tests/live-client.test.ts")}</>],
          ["Read cash", c("GET /api/v1/balances/current"), c("getBalances"), c("tests/live-client.test.ts")],
          ["Price the FX", c("POST /api/v1/fx/quotes/create"), c("createQuote"), <>{c("tests/no-double-pay.test.ts")} blocks a stale FX quote; request shape in {c("scripts/live-smoke.ts")}</>],
          ["Convert", <>{c("GET /api/v1/fx/conversions?request_id=")}, then {c("POST /api/v1/fx/conversions/create")}</>, <>{c("findConversionByRequestId")}, {c("createConversion")} (looks the id up again on any create error)</>, c("tests/conversion-lookup.test.ts")],
          ["Pay", <>{c("GET /api/v1/transfers?request_id=")}, then {c("POST /api/v1/transfers/create")}</>, <>{c("findTransferByRequestId")}, {c("createTransfer")}</>, <>{c("tests/live-client.test.ts")}, {c("tests/no-double-pay.test.ts")}</>],
          ["Read the payee", c("GET /api/v1/beneficiaries/{id}"), <>{c("getBeneficiary")} (names and the last 4 of the account only)</>, c("tests/beneficiary-fix.test.ts")],
          ["Fix the payee before paying", c("POST /api/v1/beneficiaries/{id}/update"), <>{c("updateBeneficiary")} changes {c("company_name")} and {c("bank_details.account_name")} only; executor {c("correct_beneficiary")}</>, c("tests/beneficiary-fix.test.ts")],
          ["Re-read the original", c("GET /api/v1/transfers/{id}"), c("getTransfer"), <>{c("tests/no-double-pay.test.ts")} blocks a retry while the original is SENT or PAID</>],
          ["Drive the failure (sandbox only)", c("POST /api/v1/simulation/transfers/{id}/transition"), <>{c("simulateTransferTransition")}; hop order in {c("lib/airwallex/transfer-drive.ts")}</>, c("tests/transfer-drive.test.ts")],
          ["Hear about it", <>Webhooks {c("payout.transfer.failed")}, {c("payout.transfer.cancelled")} into {c("POST /api/webhooks/airwallex")}</>, <>{c("app/api/webhooks/airwallex/route.ts")}, {c("lib/webhooks/verify.ts")}, {c("lib/webhooks/inbox.ts")}</>, c("tests/webhooks.test.ts")],
          ["Host guard", "any", <>{c("sandboxOrigin")} refuses every host except {c("api.sandbox.airwallex.com")}</>, c("tests/live-smoke-guards.test.ts")],
        ]}
      />

      <h2>Recorded sandbox run, 2026-10-27</h2>
      <p>Rerun 2026-10-28. These ids came from <code>scripts/live-smoke.ts</code>, not from the current desk build.</p>
      <Table
        head={["Step", "Result"]}
        rows={[
          ["Login", "201"],
          ["Balances", "200"],
          ["FX quote", <><code key="q">878e1b2c-070a-3b39-9b69-0a60291f9ec6</code>, EUR to USD</>],
          ["Conversion", <><code key="v">32a3bfa6-0c1e-408b-986e-84a45f472449</code>, SETTLED</>],
          ["Transfer", <><code key="t">4e1dab1a-c59b-413b-92d5-813f6caafd59</code>, SENT, FAILED (BENEFICIARY_NAME_MISMATCH), read back CANCELLED</>],
          ["Rerun 2026-10-28", "Conversion and transfer already_done. No second create, no second transition."],
        ]}
      />

      <h2>Sandbox status now</h2>
      <p className="doc-callout">
        A rerun on 2026-11-12 with the credentials on hand failed at the first call: <code>POST /api/v1/authentication/login</code> returned
        403 <code>unauthorized</code>. No sandbox ids were created. Until a login succeeds again, the 2026-10-27 and 2026-10-28 runs above are the
        only sandbox evidence, and the mock provider is what the desk demonstrates.
      </p>

      <h2>Answered from the Airwallex docs</h2>
      <ul>
        <li>Duplicate <code>request_id</code> on <code>/transfers/create</code>: 400 <code>request_id_duplicate</code>. A create still in flight returns 409 <code>request_pending</code>.</li>
        <li>List wrappers: transfers return <code>{"{ items, page_after, page_before }"}</code>, conversions return <code>{"{ has_more, items }"}</code>. Both accept a <code>request_id</code> filter.</li>
        <li>Conversion statuses: <code>SCHEDULED</code>, <code>OVERDUE</code>, <code>CANCELLED</code>, <code>SETTLED</code>.</li>
        <li>Expired quote codes differ by endpoint: <code>expired_quote</code> on conversions, <code>quote_expired</code> on transfers.</li>
      </ul>
      <h2>Still open</h2>
      <ul>
        <li>The HTTP code for a duplicate <code>request_id</code> on <code>/fx/conversions/create</code>. The executor looks the id up first, so it does not depend on the code.</li>
        <li>Whether <code>payout.transfer.cancelled</code> fires on the automatic cancel of a FAILED transfer. No webhook was subscribed in the sandbox run. The executor re-reads the transfer before paying, so a missing event cannot cause a double payment.</li>
        <li>Minimum quote headroom before converting is not documented. 60 seconds is assumed.</li>
      </ul>

      <Source paths={["docs/AIRWALLEX-MAP.md", "docs/ops-note.md", "README.md"]} />
      <Next href="/docs/claims" label="Claims and limits" />
    </article>
  );
}
