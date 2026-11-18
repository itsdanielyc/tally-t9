// L1: what a valid transaction is, and the newest-first order.
import { describe, expect, it } from "vitest";
import type { Transaction } from "../../contracts/ledger";
import { newestFirst, validateDraft } from "../../core/transactions";

const good = { date: "2026-03-14", payee: "  Corner   Shop ", amount: -1250, category: " Food ", note: " milk " };

describe("validateDraft", () => {
  it("cleans a good draft", () => {
    expect(validateDraft(good)).toEqual({
      ok: true,
      value: { date: "2026-03-14", payee: "Corner Shop", amount: -1250, category: "Food", note: "milk" },
    });
  });

  it.each([
    [{ date: "2026-02-30" }, "date"],
    [{ date: "" }, "date"],
    [{ payee: "   " }, "payee"],
    [{ payee: "x".repeat(201) }, "payee"],
    [{ amount: 12.5 }, "amount"],
    [{ amount: 0 }, "amount"],
    [{ amount: "1250" }, "amount"],
    [{ amount: Number.MAX_SAFE_INTEGER }, "amount"],
    [{ category: "c".repeat(61) }, "category"],
    [{ note: "n".repeat(1001) }, "note"],
  ])("rejects %j on the %s field", (patch, field) => {
    const r = validateDraft({ ...good, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: "invalid", field });
  });

  it("rejects something that is not a draft", () => {
    expect(validateDraft(null).ok).toBe(false);
  });
});

describe("newestFirst", () => {
  const t = (id: string, date: string): Transaction => ({ id, date, payee: id, amount: -1, categoryId: null, note: "" });

  it("orders by date descending, then most recently added first", () => {
    const list = [t("a", "2026-03-01"), t("b", "2026-03-05"), t("c", "2026-03-01"), t("d", "2025-12-31"), t("e", "2026-03-05")];
    expect(newestFirst(list).map((x) => x.id)).toEqual(["e", "b", "c", "a", "d"]);
  });

  it("does not reorder its input", () => {
    const list = [t("a", "2026-01-01"), t("b", "2026-02-01")];
    newestFirst(list);
    expect(list.map((x) => x.id)).toEqual(["a", "b"]);
  });
});
