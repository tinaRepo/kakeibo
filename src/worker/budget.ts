import type { Env } from './env'
import { hasBudgetSubscribers, notifyBudget } from './push'

const jstMonth = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7)

// 予算超過の通知: 80%到達・100%超過を、同じ月・同じカテゴリ・同じ段階で1回だけ通知する(サブスクを含む支出で判定)
export async function checkBudgets(env: Env, ledgerId: string) {
  if (!(await hasBudgetSubscribers(env, ledgerId))) return
  const db = env.DB, month = jstMonth()
  const budgets = (await db.prepare('SELECT category_id, month, amount FROM budgets WHERE ledger_id = ? AND (month IS NULL OR month = ?)').bind(ledgerId, month).all()).results as any[]
  const eff = new Map<number, number>()
  budgets.filter(b => !b.month).forEach(b => eff.set(b.category_id ?? 0, b.amount))
  budgets.filter(b => b.month).forEach(b => eff.set(b.category_id ?? 0, b.amount))
  if (!eff.size) return
  const used = new Map<number, number>()
  const add = (cid: number, a: number) => used.set(cid, (used.get(cid) || 0) + a)
  for (const r of (await db.prepare(`SELECT category_id cid, SUM(amount) a FROM transactions WHERE ledger_id = ? AND type = 'expense' AND deleted_at IS NULL AND substr(date,1,7) = ? GROUP BY 1`).bind(ledgerId, month).all()).results as any[]) add(r.cid, r.a)
  for (const s of (await db.prepare(`SELECT category_id cid, amount a FROM subscriptions WHERE ledger_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`).bind(ledgerId, month + '-31', month + '-01').all()).results as any[]) add(s.cid, s.a)
  const total = [...used.values()].reduce((a, b) => a + b, 0)
  const names = new Map(((await db.prepare('SELECT id, name FROM categories WHERE ledger_id = ?').bind(ledgerId).all()).results as any[]).map(c => [c.id, c.name]))
  for (const [cid, amount] of eff) {
    if (amount <= 0) continue
    const pct = ((cid === 0 ? total : used.get(cid) || 0) / amount) * 100
    const level = pct >= 100 ? 100 : pct >= 80 ? 80 : 0
    if (!level) continue
    const claim = async (lv: number) => (await db.prepare('INSERT OR IGNORE INTO budget_alerts(ledger_id, category_id, month, level, sent_at) VALUES(?,?,?,?,?)').bind(ledgerId, cid, month, lv, new Date().toISOString()).run()).meta.changes === 1
    if (level === 100) await claim(80)
    if (await claim(level)) {
      const name = cid === 0 ? '全体' : names.get(cid) || 'カテゴリ'
      await notifyBudget(env, ledgerId, level === 100 ? `「${name}」の予算を超えました` : `「${name}」の予算が80%に達しました`, `budget-${cid}-${month}-${level}`)
    }
  }
}
