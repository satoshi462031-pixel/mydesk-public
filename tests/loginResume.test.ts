import assert from 'node:assert/strict'
import test from 'node:test'
import type { NavigationState } from '@react-navigation/native'
import { loginResumeFrom } from '../src/utils/loginResume'

function rootState(routes: Array<{ name: string; params?: object; state?: object }>): NavigationState {
  return {
    key: 'root', index: routes.length - 1, routeNames: ['MainTabs', 'Login', 'Paywall', 'Onboarding'], stale: false, type: 'stack',
    routes: routes.map((route, i) => ({ key: `${route.name}-${i}`, ...route })),
  } as NavigationState
}

const tabs = { index: 1, routes: [{ name: 'PlanTab' }, { name: 'FeedTab', state: { index: 1, routes: [{ name: 'DeskFeed' }, { name: 'PublicDesk', params: { deskId: 'd1' } }] } }] }

test('本編からログインしたら、ログイン画面を除いた並び（タブの中の画面まで）へ戻す', () => {
  const resume = loginResumeFrom(rootState([{ name: 'MainTabs', state: tabs }, { name: 'Login', params: { mode: 'signin' } }]))
  assert.ok(resume?.state)
  assert.deepEqual(resume.state.routes.map((route) => route.name), ['MainTabs'])
  assert.equal(resume.state.index, 0)
  assert.deepEqual(resume.state.routes[0].state, tabs)
  assert.equal(resume.paywall, undefined)
})

test('Paywall から来たときは、並びを戻したうえで同じ理由の Paywall を開き直す', () => {
  const resume = loginResumeFrom(rootState([
    { name: 'MainTabs', state: tabs },
    { name: 'Login', params: { mode: 'signup', resumePaywall: { reason: 'aiFeatures' } } },
  ]))
  assert.deepEqual(resume?.state?.routes.map((route) => route.name), ['MainTabs'])
  assert.deepEqual(resume?.paywall, { reason: 'aiFeatures' })
})

test('初回案内から入ったログインは戻す先が無い（本編の最初へ進める）', () => {
  assert.equal(loginResumeFrom(rootState([{ name: 'Onboarding' }, { name: 'Login', params: { entry: 'onboarding' } }])), null)
  assert.equal(loginResumeFrom(rootState([{ name: 'Login' }])), null)
})

test('ログイン画面以外が前面のとき・状態が無いときは何もしない', () => {
  assert.equal(loginResumeFrom(rootState([{ name: 'MainTabs', state: tabs }])), null)
  assert.equal(loginResumeFrom(rootState([{ name: 'MainTabs' }, { name: 'Login' }, { name: 'Paywall' }])), null)
  assert.equal(loginResumeFrom(undefined), null)
})
