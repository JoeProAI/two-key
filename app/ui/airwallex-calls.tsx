import type { DeskView } from "@/lib/desk/types";

const RECORDED = "2026-10-27";

/** Static map of the corridor. This deploy answers every row with the mock provider. */
export function AirwallexCalls({ view }: { view: DeskView }) {
  const conv = view.conversionCalls ?? 0;
  const xfer = view.transferCalls ?? 0;
  const rows: { step: string; endpoint: string; mock: string; sandbox: string }[] = [
    { step: "Sign in", endpoint: "POST /api/v1/authentication/login", mock: "Not needed by the mock", sandbox: "201" },
    { step: "Read cash", endpoint: "GET /api/v1/balances/current", mock: "Mock answered", sandbox: "200" },
    { step: "Price the FX", endpoint: "POST /api/v1/fx/quotes/create", mock: "Mock answered", sandbox: "quote 878e1b2c-070a-3b39-9b69-0a60291f9ec6" },
    { step: "Convert, request_id looked up first", endpoint: "GET /api/v1/fx/conversions?request_id= then POST /api/v1/fx/conversions/create", mock: `Mock answered. Conversion calls ${conv}`, sandbox: "conversion 32a3bfa6-0c1e-408b-986e-84a45f472449 SETTLED" },
    { step: "Pay, request_id looked up first", endpoint: "GET /api/v1/transfers?request_id= then POST /api/v1/transfers/create", mock: `Mock answered. Transfer calls ${xfer}`, sandbox: "transfer 4e1dab1a-c59b-413b-92d5-813f6caafd59" },
    { step: "Drive the failure", endpoint: "POST /api/v1/simulation/transfers/{id}/transition", mock: "Fixture history", sandbox: "SENT, FAILED (BENEFICIARY_NAME_MISMATCH), read back CANCELLED" },
    { step: "Hear about it", endpoint: "Webhooks payout.transfer.failed and payout.transfer.cancelled", mock: `Fixture deliveries ${view.webhooks.length}`, sandbox: "Not subscribed. Delivery unconfirmed." },
  ];
  return (
    <section className="awx" id="airwallex" aria-labelledby="awx-title">
      <h2 id="awx-title">Airwallex calls</h2>
      <p>This deploy is MOCK. It did not call Airwallex. Each step maps to the endpoint below. The right column is the recorded sandbox run on {RECORDED}, rerun {"2026-10-28"} with already_done and no second create.</p>
      <ol className="awx-rows">
        {rows.map((row) => (
          <li key={row.endpoint}>
            <strong>{row.step}</strong>
            <code>{row.endpoint}</code>
            <span><em>This deploy:</em> {row.mock}</span>
            <span><em>Sandbox {RECORDED}:</em> {row.sandbox}</span>
          </li>
        ))}
      </ol>
      <p>Map from desk step to code and test: docs/AIRWALLEX-MAP.md. Rerun with sandbox keys: npm run proof.</p>
    </section>
  );
}
