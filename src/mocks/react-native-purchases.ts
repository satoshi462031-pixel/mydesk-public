// react-native-purchases のスタブ
// Expo Go（Dev Build なし）でも起動できるよう、何もしない実装を提供する。
// Dev Build 時は metro.config.js のエイリアスが解除され、本物が使われる。

const stub = {
  configure:                      () => {},
  logIn:                          async () => ({ customerInfo: _freeInfo(), created: false }),
  logOut:                         async () => _freeInfo(),
  getCustomerInfo:                async () => _freeInfo(),
  getOfferings:                   async () => ({ current: null, all: {} }),
  purchasePackage:                async () => { throw Object.assign(new Error('stub'), { userCancelled: true }) },
  restorePurchases:               async () => _freeInfo(),
  // 戻り値は実物と同じ形にする（実物は何も返さない）。{ remove } を返すと、
  // 実物では動かない解除の書き方がこのスタブでだけ通ってしまう
  addCustomerInfoUpdateListener:    () => {},
  removeCustomerInfoUpdateListener: () => true,
}

function _freeInfo() {
  return { entitlements: { active: {}, all: {} } }
}

export default stub
