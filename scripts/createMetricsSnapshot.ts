import fs from 'node:fs'
import path from 'node:path'

type Args = Record<string, string>

function parseArgs(argv: string[]): Args {
  const result: Args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    const value = argv[i + 1]
    if (!key || value == null || argv[i] === key) throw new Error(`Invalid argument near: ${argv[i] ?? '(end)'}`)
    result[key] = value
  }
  return result
}

function required(args: Args, key: string): string {
  const value = args[key]
  if (value == null || value === '') throw new Error(`Missing --${key}`)
  return value
}

function number(args: Args, key: string, min = 0): number {
  const value = Number(required(args, key))
  if (!Number.isFinite(value) || value < min) throw new Error(`--${key} must be a number >= ${min}`)
  return value
}

function boundedNumber(args: Args, key: string, min: number, max: number): number {
  const value = number(args, key, min)
  if (value > max) throw new Error(`--${key} must be <= ${max}`)
  return value
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null
}

const args = parseArgs(process.argv.slice(2))
const month = required(args, 'month')
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('--month must be YYYY-MM')

const downloads = number(args, 'downloads')
const organicDownloads = number(args, 'organic-downloads')
const analyticsUsers = number(args, 'analytics-users')
const activatedUsers = number(args, 'activated-users')
const d30Eligible = number(args, 'd30-eligible')
const d30Retained = number(args, 'd30-retained')
const subscribersAtStart = number(args, 'subscribers-start')
const subscribersAtEnd = number(args, 'subscribers-end')
const newPaidUsers = number(args, 'new-paid-users')
const cancelledSubscribers = number(args, 'cancelled-subscribers')
const adSpendYen = number(args, 'ad-spend-yen')
const attributedPaidInstalls = number(args, 'attributed-paid-installs')
const attributedNewPaidUsers = number(args, 'attributed-new-paid-users')
if (organicDownloads > downloads) throw new Error('--organic-downloads cannot exceed --downloads')
if (activatedUsers > analyticsUsers) throw new Error('--activated-users cannot exceed --analytics-users')
if (d30Retained > d30Eligible) throw new Error('--d30-retained cannot exceed --d30-eligible')

const snapshot = {
  schemaVersion: 1,
  month,
  generatedAt: new Date().toISOString(),
  acquisition: {
    downloads,
    organicDownloads,
    organicShare: ratio(organicDownloads, downloads),
    adSpendYen,
    attributedPaidInstalls,
    costPerInstallYen: attributedPaidInstalls > 0 ? Math.round(adSpendYen / attributedPaidInstalls) : null,
    attributedNewPaidUsers,
    paidCustomerAcquisitionCostYen: attributedNewPaidUsers > 0 ? Math.round(adSpendYen / attributedNewPaidUsers) : null,
  },
  product: {
    analyticsUsers,
    activatedUsers,
    activationRateAmongConsented: ratio(activatedUsers, analyticsUsers),
    d30Eligible,
    d30Retained,
    d30Retention: ratio(d30Retained, d30Eligible),
  },
  subscription: {
    subscribersAtStart,
    subscribersAtEnd,
    newPaidUsers,
    cancelledSubscribers,
    periodDownloadToPaidRate: ratio(newPaidUsers, downloads),
    monthlySubscriberChurn: ratio(cancelledSubscribers, subscribersAtStart),
    grossMrrYen: number(args, 'gross-mrr-yen'),
    netRevenueYen: number(args, 'net-revenue-yen'),
  },
  quality: {
    rating: boundedNumber(args, 'rating', 0, 5),
    reviews: number(args, 'reviews'),
    crashFreeSessionsPct: boundedNumber(args, 'crash-free-sessions-pct', 0, 100),
  },
  evidence: {
    appStore: required(args, 'app-store-report'),
    posthog: required(args, 'posthog-report'),
    revenueCat: required(args, 'revenuecat-report'),
    sentry: required(args, 'sentry-report'),
    ads: required(args, 'ad-report'),
  },
  notes: args.notes ?? '',
}

const outputDir = path.resolve('docs', 'metrics', 'snapshots')
const outputPath = path.join(outputDir, `${month}.json`)
fs.mkdirSync(outputDir, { recursive: true })
if (fs.existsSync(outputPath) && args.overwrite !== 'true') {
  throw new Error(`${outputPath} already exists; pass --overwrite true to replace it`)
}
fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
console.log(outputPath)
