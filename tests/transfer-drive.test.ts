import { describe, expect, it } from "vitest";
import { AirwallexError, type Transfer, type TransferStatus } from "@/lib/airwallex/types";
import { driveFailedThenCancelled } from "@/lib/airwallex/transfer-drive";

function transfer(status: TransferStatus): Transfer {
  return {
    id: "t1",
    request_id: "r",
    status,
    transfer_amount: 10,
    transfer_currency: "USD",
    created_at: "2026-10-27T00:00:00+0000",
  };
}

describe("sandbox transfer drive", () => {
  it("goes PROCESSING to SENT to FAILED, then sees the auto-cancel on GET", async () => {
    let status: TransferStatus = "PROCESSING";
    const calls: string[] = [];
    const awx = {
      async getTransfer() {
        if (status === "FAILED") status = "CANCELLED";
        return transfer(status);
      },
      async simulateTransferTransition(_id: string, next: TransferStatus, failureType?: string) {
        calls.push(`${status}->${next}:${failureType ?? ""}`);
        if (next === "FAILED" && status === "PROCESSING") throw new AirwallexError("no", 500, "operation_failed");
        if (next === "SENT" && status === "PROCESSING") {
          status = "SENT";
          return transfer(status);
        }
        if (next === "FAILED" && status === "SENT") {
          status = "FAILED";
          return transfer(status);
        }
        throw new AirwallexError(`unexpected ${status}->${next}`, 500);
      },
    };
    const drive = await driveFailedThenCancelled(awx, "t1", "BENEFICIARY_NAME_MISMATCH", async () => {});
    expect(calls).toEqual([
      "PROCESSING->SENT:",
      "SENT->FAILED:BENEFICIARY_NAME_MISMATCH",
    ]);
    expect(drive.finalStatus).toBe("CANCELLED");
    expect(drive.autoCancelled).toBe(true);
    expect(drive.hops).toContain("read-back=CANCELLED");
  });

  it("calls CANCELLED when the transfer stays FAILED", async () => {
    let status: TransferStatus = "FAILED";
    const calls: TransferStatus[] = [];
    const awx = {
      async getTransfer() {
        return transfer(status);
      },
      async simulateTransferTransition(_id: string, next: TransferStatus) {
        calls.push(next);
        status = next;
        return transfer(status);
      },
    };
    const drive = await driveFailedThenCancelled(awx, "t1", "BENEFICIARY_NAME_MISMATCH", async () => {});
    expect(calls).toEqual(["CANCELLED"]);
    expect(drive.autoCancelled).toBe(false);
    expect(drive.finalStatus).toBe("CANCELLED");
  });

  it("does not transition a transfer that is already CANCELLED", async () => {
    let calls = 0;
    const awx = {
      async getTransfer() {
        return transfer("CANCELLED");
      },
      async simulateTransferTransition() {
        calls++;
        return transfer("CANCELLED");
      },
    };
    const drive = await driveFailedThenCancelled(awx, "t1", "BENEFICIARY_NAME_MISMATCH", async () => {});
    expect(calls).toBe(0);
    expect(drive.hops).toEqual(["already CANCELLED"]);
  });

  it("waits out SCHEDULED until the transfer is PROCESSING", async () => {
    let reads = 0;
    let status: TransferStatus = "SCHEDULED";
    const awx = {
      async getTransfer() {
        reads++;
        if (reads >= 2 && status === "SCHEDULED") status = "PROCESSING";
        if (status === "FAILED") status = "CANCELLED";
        return transfer(status);
      },
      async simulateTransferTransition(_id: string, next: TransferStatus) {
        if (next === "FAILED" && status === "PROCESSING") throw new AirwallexError("no", 500, "operation_failed");
        status = next === "FAILED" ? "FAILED" : next;
        return transfer(status === "FAILED" ? "FAILED" : status);
      },
    };
    const drive = await driveFailedThenCancelled(awx, "t1", "BENEFICIARY_NAME_MISMATCH", async () => {});
    expect(drive.finalStatus).toBe("CANCELLED");
    expect(drive.hops[0]).toBe("poll=PROCESSING");
  });
});
