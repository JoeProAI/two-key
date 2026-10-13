# Two-Key demo video: beat sheet

Target length: 4:30. Hard cap: 5:00. Two stories: the $40k supplier payment (main) and the $25k payment that waits for a tap (scenario b).

Recording rules:
- Sandbox only. Every id on screen comes from the Airwallex sandbox or the mock. No real customer data.
- No keys on screen. Keep the terminal env and `.env.local` off camera.
- Before recording, run `npm run demo`, `npm run demo -- rerun`, `npm run demo -- approval` and `npm run demo -- approval-timeout` once so the output matches what you say.
- The receipt text in the terminal is the source of truth. If the UI pass lands, show the same lines there.

## Beat sheet

| Time | On screen | Voiceover |
|---|---|---|
| 0:00 to 0:15 | Title card: "Two-Key. A payment ops agent that won't pay twice." | "When a supplier payment fails, someone has to figure out if it's safe to send again. Get it wrong and you pay twice. Two-Key does that job, and every money move needs two keys." |
| 0:15 to 0:35 | Airwallex sandbox: transfer INV-2291, USD 40,000, status CANCELLED, failure reason "Beneficiary account name mismatch". | "Here's the setup. A $40,000 payment to Northwind Steel failed on a bad account name. Airwallex cancels failed transfers on its own a few seconds later." |
| 0:35 to 0:55 | Webhook log: four deliveries. `evt_failed_01` twice, then `evt_cancel_02`, then `evt_proc_00` arriving last. | "Then the notices came in messy. The same failure notice came twice. An old PROCESSING notice came in last. If you trust arrival order, you think the money is still moving." |
| 0:55 to 1:10 | Balances: USD 22,000, EUR 60,000. Reserve USD 10,000. Queued: agency retainer USD 7,000. | "We only have $22,000 in USD, and we keep a $10,000 floor. There's also a $7,000 retainer queued for next week." |
| 1:10 to 1:30 | Terminal: `npm run demo`. Receipt line "Round 1. Planner: Retry USD 40000 to the supplier (2 failure notices received)." | "The planner goes first. It does what a rushed person would do: two failure notices, so two retries." |
| 1:30 to 2:00 | Receipt lines under Round 1: BLOCK double_payment, BLOCK unstable_request_id, BLOCK reserve_breach, notes duplicate_webhook and out_of_order_webhook. Then "Decision: blocked". | "The second agent is the Wringer. Its only job is to break the plan. It sees one unique failure, not two, so two retries would pay twice. It sees the out-of-order notice and trusts the timestamps instead. And it sees we'd go under our floor. Blocked." |
| 2:00 to 2:25 | Receipt line "Round 2. Planner: Retry once with a stable request_id, buy 28000 USD with EUR at the quoted rate, defer 1 low-priority payout(s)." Then "Decision: approved, approved by joe". | "Round two. One retry with a fixed request ID. Buy $28,000 with euros on a live quote. Push the retainer back. The Wringer has nothing left to block. It's over $10,000, so it waits for me. One tap." |
| 2:25 to 2:45 | Executed lines: defer_payout ok, fx_conversion ok, retry_transfer ok. Balances after: USD 10,000. Sandbox shows one new transfer. | "It funds first, then pays. One conversion, one transfer, and we end exactly on the $10,000 floor." |
| 2:45 to 3:05 | Terminal: `npm run demo -- rerun`. Executed lines read fx_conversion `already_done` and retry_transfer `already_done`. Counter: "Transfers created: 1 \| conversions: 1". | "Now the scary part. Run it again, even with the ledger wiped. Before it sends anything, Two-Key asks Airwallex if that request ID already exists. It does. Nothing new goes out." |
| 3:05 to 3:20 | Terminal: `npm run demo -- approval`. Receipt line "Round 1. Planner: Retry once with a stable request_id." No BLOCK lines. | "Second story. A $25,000 payment to Halvorsen Freight. This one is clean. The Wringer finds nothing to block." |
| 3:20 to 3:45 | Receipt line "Waited 90 min for the tap. 2 checks, no money moved while waiting." Sandbox shows no new transfer until the tap. | "But it's over the limit, so it sits and waits. Ninety minutes go by. It checks in, and nothing moves. Then I approve it, and it pays once." |
| 3:45 to 4:10 | Terminal: `npm run demo -- approval-timeout`. Lines "Decision: expired" and "Expired after 240 min with no tap. Nothing moved. Re-plan with fresh balances." | "If nobody taps within four hours, the approval runs out. A late tap gets refused. Balances and rates change, so Two-Key starts over instead of paying on old facts." |
| 4:10 to 4:30 | Receipt shown in full, then a closing card: "Planner proposes. Wringer objects. A person taps. Airwallex sandbox: transfers, FX quotes and conversions, balances, webhooks." | "Every proposal, every objection, every tap and every Airwallex response ends up on one receipt a finance lead can read. That's Two-Key." |

## Cut list if it runs long

1. Drop the 0:55 balances beat and say the numbers over the Round 2 line.
2. Drop the `approval-timeout` run and say the timeout in one line over the 3:20 beat.
