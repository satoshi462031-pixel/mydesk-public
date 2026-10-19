const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((pairs, value, index, all) => {
  if (index % 2 === 0) pairs.push([value.replace(/^--/, ''), all[index + 1] ?? ''])
  return pairs
}, []))

const providerId = args['provider-id']
const campaign = args.campaign
if (!/^\d+$/.test(providerId ?? '')) throw new Error('--provider-id must be numeric')
if (!/^[A-Za-z0-9._~-]{1,40}$/.test(campaign ?? '')) {
  throw new Error('--campaign must be 1-40 ASCII slug characters')
}

const appStore = new URL('https://apps.apple.com/app/apple-store/id6798069737')
appStore.searchParams.set('pt', providerId)
appStore.searchParams.set('ct', campaign)
appStore.searchParams.set('mt', '8')

const landing = new URL('https://mydesk.page/')
landing.searchParams.set('utm_source', args.source || 'twitter')
landing.searchParams.set('utm_medium', args.medium || 'paid_social')
landing.searchParams.set('utm_campaign', campaign)
if (args.content) landing.searchParams.set('utm_content', args.content)

console.log(JSON.stringify({ campaign, appStoreUrl: appStore.toString(), landingUrl: landing.toString() }, null, 2))
