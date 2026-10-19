import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GadgetCategory, Port } from '../src/types'
import { createAdminClient, loadEnv } from './importRakuten'

type ProductSpec = {
  category: Extract<GadgetCategory, 'MobileBattery' | 'PowerStrip'>
  ports: Port[]
  sourceUrl: string
}

const port = (id: string, type: Port['type'], direction: Port['direction'], count = 1, label?: string): Port =>
  ({ id, type, direction, count, label })

const battery = (
  usbCBidirectional: number,
  usbCOutput: number,
  usbAOutput: number,
  sourceUrl: string,
  acInput = false,
): Omit<ProductSpec, 'category'> => ({
  ports: [
    ...(usbCBidirectional ? [port('usbc-io', 'USB_C', 'bidirectional', usbCBidirectional)] : []),
    ...(usbCOutput ? [port('usbc-out', 'USB_C', 'output', usbCOutput)] : []),
    ...(usbAOutput ? [port('usba-out', 'USB_A', 'output', usbAOutput)] : []),
    ...(acInput ? [port('ac-in', 'Power', 'input')] : []),
  ],
  sourceUrl,
})

const mobile = (ports: Port[], sourceUrl: string): Omit<ProductSpec, 'category'> => ({ ports, sourceUrl })

const strip = (
  outlets: number,
  usbC: number,
  usbA: number,
  sourceUrl: string,
  grounded = false,
): Omit<ProductSpec, 'category'> => ({
  ports: [
    port('ac-out', 'Power', 'output', outlets, grounded ? 'アース付き（3極）' : '2極'),
    ...(usbC ? [port('usbc-out', 'USB_C', 'output', usbC)] : []),
    ...(usbA ? [port('usba-out', 'USB_A', 'output', usbA)] : []),
    port('ac-in', 'Power', 'input'),
  ],
  sourceUrl,
})

const SPECS = new Map<string, ProductSpec>([
  ['8feb8158-ebe4-497a-bb5a-c4a472a581cc', { category: 'MobileBattery', ...battery(2, 0, 1, 'https://www.ankerjapan.com/products/a1259') }],
  ['645d6acd-a0f1-4e2e-8ab2-9196e3e2c18f', { category: 'MobileBattery', ...battery(2, 0, 0, 'https://www.ankerjapan.com/products/a1637', true) }],
  ['0daa7487-7473-4107-b4e0-17fc3dbe724e', { category: 'MobileBattery', ...battery(2, 0, 0, 'https://www.ankerjapan.com/products/a1637', true) }],
  ['c6260794-44ce-471e-9d33-1287a734907e', { category: 'MobileBattery', ...battery(2, 0, 1, 'https://lp.ankerjapan.com/hubfs/aoos/manual/A1256QSG.pdf') }],
  ['b2956bce-2ded-4740-a58a-1f0881ba9a19', { category: 'MobileBattery', ...battery(0, 1, 1, 'https://www.ankerjapan.com/products/a1623', true) }],
  ['a097631e-0d7d-4e22-a3ff-78d30974aaca', { category: 'MobileBattery', ...battery(2, 0, 1, 'https://connectinternationalone.co.jp/wp/wp-content/uploads/2023/12/240202_SMARTCOBYProSLIM_UM.pdf') }],
  ['ffdf5e90-855e-44fa-9e68-c6417fc6ddc5', { category: 'MobileBattery', ...battery(1, 0, 1, 'https://motteru.co.jp/product/mobile_battery/10000mah/mot-mb10001/') }],
  ['e90bda2f-49e2-439f-8373-cf836b97a671', { category: 'MobileBattery', ...battery(1, 1, 1, 'https://ugreen.jp/products/145w-power-bank-mobile-battery') }],
  ['cb1f87cd-2534-40f6-a9a4-3774d28ed054', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('wireless-out', 'wirelessCharging', 'output'),
  ], 'https://www.ankerjapan.com/products/a1614') }],
  ['aa1cc56c-a3c3-489f-b286-441cd8657e44', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usba-out', 'USB_A', 'output'),
    port('wireless-out', 'wirelessCharging', 'output'),
  ], 'https://www.ankerjapan.com/products/a1641') }],
  ['fcf4df17-70be-44c7-be8f-fdbac842498e', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('wireless-out', 'wirelessCharging', 'output'),
  ], 'https://www.ankerjapan.com/products/a1664') }],
  ['2c4d1e05-ecbf-461e-aea3-a66ac88f1f0a', { category: 'MobileBattery', ...battery(2, 0, 1, 'https://www.ankerjapan.com/products/a1257') }],
  ['228704cc-ebbd-4031-ab5f-954bd1ad57b3', { category: 'MobileBattery', ...battery(2, 0, 1, 'https://www.ankerjapan.com/products/a1257') }],
  ['ddd60e36-f008-44dd-bbad-9941e06a09ae', { category: 'MobileBattery', ...mobile([
    port('usbc-cable-io', 'USB_C', 'bidirectional', 1, '内蔵USB-Cケーブル'),
    port('usbc-out', 'USB_C', 'output'),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://www.ankerjapan.com/products/a1688') }],
  ['de93ba4b-53f5-4c88-bb57-c32e063e44e4', { category: 'MobileBattery', ...mobile([
    port('usbc-port-io', 'USB_C', 'bidirectional'),
    port('usbc-cable-io', 'USB_C', 'bidirectional', 1, '内蔵USB-Cケーブル'),
    port('usba-out', 'USB_A', 'output'),
    port('lightning-out', 'Lightning', 'output', 1, '内蔵Lightningケーブル'),
  ], 'https://item.rakuten.co.jp/aiwo/hyd063/') }],
  ['841fa508-d376-457f-899a-f72ab2fe4c69', { category: 'MobileBattery', ...mobile([
    port('usbc-in', 'USB_C', 'input'),
    port('micro-in', 'microUSB', 'input'),
    port('usba-cable-in', 'USB_A', 'input', 1, '内蔵USB-A充電ケーブル'),
    port('usba-out', 'USB_A', 'output', 2),
    port('usbc-cable-out', 'USB_C', 'output', 1, '内蔵USB-Cケーブル'),
    port('micro-cable-out', 'microUSB', 'output', 1, '内蔵microUSBケーブル'),
    port('lightning-out', 'Lightning', 'output', 1, '内蔵Lightningケーブル'),
  ], 'https://item.rakuten.co.jp/aiwo/hyg069-copy/') }],
  ['90c0d3aa-ed4f-407c-a9ec-2e685a707d12', { category: 'MobileBattery', ...mobile([
    port('usbc-in', 'USB_C', 'input'),
    port('micro-in', 'microUSB', 'input'),
    port('usba-cable-in', 'USB_A', 'input', 1, '内蔵USB-A充電ケーブル'),
    port('usba-out', 'USB_A', 'output', 2),
    port('usbc-cable-out', 'USB_C', 'output', 1, '内蔵USB-Cケーブル'),
    port('micro-cable-out', 'microUSB', 'output', 1, '内蔵microUSBケーブル'),
    port('lightning-out', 'Lightning', 'output', 1, '内蔵Lightningケーブル'),
  ], 'https://item.rakuten.co.jp/aiwo/hyg069/') }],
  ['b8e79f01-7af7-4cc8-8881-3cf7cce396c2', { category: 'MobileBattery', ...mobile([
    port('usbc-in', 'USB_C', 'input'),
    port('micro-in', 'microUSB', 'input'),
    port('usba-out', 'USB_A', 'output', 2),
  ], 'https://item.rakuten.co.jp/aiwo/hyg076-copy/') }],
  ['96df859a-972b-4a37-a1db-3e170fae5483', { category: 'MobileBattery', ...mobile([
    port('micro-in', 'microUSB', 'input'),
    port('usba-cable-in', 'USB_A', 'input', 1, '内蔵USB-A充電ケーブル'),
    port('usba-out', 'USB_A', 'output'),
    port('usbc-cable-out', 'USB_C', 'output', 1, '内蔵USB-Cケーブル'),
    port('micro-cable-out', 'microUSB', 'output', 1, '内蔵microUSBケーブル'),
    port('lightning-out', 'Lightning', 'output', 1, '内蔵Lightningケーブル'),
  ], 'https://www.rakuten.ne.jp/gold/genesis-shop/setsumei/gp2-10000.pdf') }],
  ['da55ef39-a622-47be-bdb2-ff213ece8289', { category: 'MobileBattery', ...mobile([
    port('micro-in', 'microUSB', 'input'),
    port('usba-cable-in', 'USB_A', 'input', 1, '内蔵USB-A充電ケーブル'),
    port('usba-out', 'USB_A', 'output'),
    port('usbc-cable-out', 'USB_C', 'output', 1, '内蔵USB-Cケーブル'),
    port('micro-cable-out', 'microUSB', 'output', 1, '内蔵microUSBケーブル'),
    port('lightning-out', 'Lightning', 'output', 1, '内蔵Lightningケーブル'),
  ], 'https://www.rakuten.ne.jp/gold/genesis-shop/setsumei/gp2-10000.pdf') }],
  ['9bfa89c5-4e8d-46d2-9f48-24200c9eacc4', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('lightning-in', 'Lightning', 'input'),
    port('wireless-out', 'wirelessCharging', 'output'),
  ], 'https://item.rakuten.co.jp/japaemo/17-bat57/') }],
  ['1e257e3b-9e74-4169-b9e7-43b2d8ef7220', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usba-out', 'USB_A', 'output', 2),
  ], 'https://item.rakuten.co.jp/relief10/b08jtq66k7/') }],
  ['bfe7af66-8073-4e61-a2b6-bad0b6562c41', { category: 'MobileBattery', ...mobile([
    port('usbc-in', 'USB_C', 'input'),
    port('micro-in', 'microUSB', 'input'),
    port('usba-out', 'USB_A', 'output', 2),
  ], 'https://item.rakuten.co.jp/weiwei/mbat03/') }],
  ['f2d0ccde-6d93-4c25-ba6c-b8bd39b59565', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://item.rakuten.co.jp/loof-shop/work09c/') }],
  ['1d309c36-1d29-4bf6-ab87-8dd47708bbca', { category: 'MobileBattery', ...mobile([
    port('usbc-in', 'USB_C', 'input'),
    port('wireless-out', 'wirelessCharging', 'output'),
  ], 'https://item.rakuten.co.jp/zian/mobamag/') }],
  ['de346564-9fa9-43a4-94d9-e6acde3396bc', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://motteru.co.jp/product/mobile_battery/10000mah/mot-mbss10002/') }],
  ['0208792a-76bb-41e9-9521-7eb8a7452f21', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usbc-cable-out', 'USB_C', 'output', 1, '内蔵USB-Cケーブル'),
    port('usba-out', 'USB_A', 'output'),
    port('lightning-out', 'Lightning', 'output', 1, '内蔵Lightningケーブル'),
  ], 'https://item.rakuten.co.jp/nashop23/dlp5713/') }],
  ['f2ed6681-2b99-4ff0-bbf9-0752ed396714', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usbc-cable-out', 'USB_C', 'output', 1, '内蔵USB-Cケーブル'),
    port('lightning-out', 'Lightning', 'output', 1, '内蔵Lightningケーブル'),
    port('watch-out', 'wirelessCharging', 'output', 1, 'Apple Watch充電'),
  ], 'https://item.rakuten.co.jp/rorrystore/phce-mb-08/') }],
  ['e9fdb6d8-d95d-4687-9ded-5a1c5dcfcf40', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usba-out', 'USB_A', 'output', 2),
  ], 'https://ugreen.jp/products/ugreen-%E3%83%A2%E3%83%90%E3%82%A4%E3%83%AB%E3%83%90%E3%83%83%E3%83%86%E3%83%AA%E3%83%BC-20000mah') }],
  ['027157e3-83fa-4f3d-afc9-2d1584df1ba0', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usbc-cable-io', 'USB_C', 'bidirectional', 1, '内蔵USB-Cケーブル'),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://item.rakuten.co.jp/ugreen-gear/55988/') }],
  ['b8f88717-ac89-4d21-9d27-dc7116df080c', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usbc-cable-io', 'USB_C', 'bidirectional', 1, '内蔵USB-Cケーブル'),
    port('wireless-out', 'wirelessCharging', 'output'),
  ], 'https://ugreen.jp/products/ugreen-25w-magnetic-power-bank-10000mah') }],
  ['966f21d6-9eed-4171-8d0a-f9fa08208cfb', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://item.rakuten.co.jp/ugreen-gear/25185/') }],
  ['7eef93a8-dd7b-4538-9f3e-7d675f3a3541', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://www.elecom.co.jp/products/EC-C03BK.html') }],
  ['fd4d7bac-3484-4ca6-812b-3696dc5fb6c1', { category: 'MobileBattery', ...mobile([
    port('usbc1-io', 'USB_C', 'bidirectional'),
    port('usbc2-out', 'USB_C', 'output'),
    port('usba-out', 'USB_A', 'output'),
    port('ac-in', 'Power', 'input'),
  ], 'https://www.ankerjapan.com/products/a1651') }],
  ['25240254-6de0-4ed2-b1a5-4f81614f4466', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('wireless-out', 'wirelessCharging', 'output'),
  ], 'https://service.anker.com/product-description/a085g00000GjECrAAN/anker-maggo-power-bank-10000mah-15w') }],
  ['186b9a28-e0d9-4ceb-83b6-41990ae2a44b', { category: 'MobileBattery', ...mobile([
    port('usbc-connector-io', 'USB_C', 'bidirectional', 1, '内蔵USB-Cコネクター'),
    port('usbc-port-io', 'USB_C', 'bidirectional'),
  ], 'https://www.ankerjapan.com/products/a1653') }],
  ['1933df74-391d-4272-b42e-8419bb9dc9d6', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional', 2),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://www.ankerjapan.com/products/a1336') }],
  ['57c95c09-4450-415b-8795-cb8049fdbe77', { category: 'MobileBattery', ...mobile([
    port('micro-in', 'microUSB', 'input'),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://www.ankerjapan.com/products/a1263') }],
  ['aef09cd8-49a2-4fe2-917e-268f248cd986', { category: 'MobileBattery', ...mobile([
    port('lightning-in', 'Lightning', 'input'),
    port('wireless-out', 'wirelessCharging', 'output'),
  ], 'https://support.apple.com/en-mide/111857') }],
  ['0013a4e8-cba1-4454-a647-77871ae72ae7', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('micro-in', 'microUSB', 'input'),
    port('usba-out', 'USB_A', 'output'),
    port('wireless-out', 'wirelessCharging', 'output'),
  ], 'https://jp.aukey.com/blogs/news/launch-10000mah-power-bank-basix-pro-mini') }],
  ['14461341-aa62-46ba-b48c-282a86cdb5b6', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://cheero.net/battery_che108/') }],
  ['c81d2a82-0658-4f0b-9c78-f0c733a9de5f', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('wireless-out', 'wirelessCharging', 'output'),
  ], 'https://connectinternationalone.co.jp/wp/wp-content/uploads/2025/02/250806_SMARTCOBY-SLIM-5K_UM_w60mm-h75mm.pdf') }],
  ['254396da-0f47-4736-918f-14928569a7ff', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional', 2),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://connectinternationalone.co.jp/wp/wp-content/uploads/2023/12/240202_SMARTCOBYProSLIM_UM.pdf') }],
  ['809b27cd-3902-4154-9615-e69d64308b8a', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional', 2),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://manuals.plus/ja/asin/B0CHVW87D5') }],
  ['a0539a65-f979-4837-9213-bce345ae6308', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usba-out', 'USB_A', 'output'),
  ], 'https://www.elecom.co.jp/products/EC-C03BK.html') }],
  ['84038e50-0edf-4dc4-b873-3f797e763dcd', { category: 'MobileBattery', ...mobile([
    port('usbc-io', 'USB_C', 'bidirectional'),
    port('usba-out', 'USB_A', 'output'),
    port('dc-out', 'DCPower', 'output'),
  ], 'https://item.rakuten.co.jp/gekiyasukan/g-1770/') }],

  ['36d96a28-99eb-4180-a370-702de0a7ec25', { category: 'PowerStrip', ...strip(3, 1, 2, 'https://www.ankerjapan.com/products/a9139') }],
  ['f91b441c-cc89-418c-867c-168222f0f5ae', { category: 'PowerStrip', ...strip(3, 2, 2, 'https://www.ankerjapan.com/products/a91c0') }],
  ['f4dbfcc2-3e3f-4bfd-9413-242ce98981da', { category: 'PowerStrip', ...strip(2, 2, 1, 'https://www.ankerjapan.com/products/a9125') }],
  ['4378eaf2-71f6-4ae7-9e70-f0524f09d0cd', { category: 'PowerStrip', ...strip(3, 4, 2, 'https://www.ankerjapan.com/products/a91c6') }],
  ['101ef762-c6e9-4e7b-b665-f967f5693418', { category: 'PowerStrip', ...strip(4, 2, 2, 'https://www.ankerjapan.com/products/a91c3') }],
  ['0ddc64d2-a4e7-456a-9a5f-d13b570bb52a', { category: 'PowerStrip', ...strip(2, 2, 2, 'https://www.ankerjapan.com/products/a9129') }],
  ['d969343a-eb76-4606-8f25-ce432b064d8d', { category: 'PowerStrip', ...strip(8, 1, 2, 'https://www.ankerjapan.com/products/a9183') }],
  ['5e1f51c3-7c5e-43f6-a21e-d8402a5e768f', { category: 'PowerStrip', ...strip(6, 2, 2, 'https://www.ankerjapan.com/products/a91f2') }],
  ['38c487b3-25bd-48ec-9ea8-32c8405aa386', { category: 'PowerStrip', ...strip(6, 0, 0, 'https://item.rakuten.co.jp/superdeal/11794t-k6a-26252set20220604/') }],
  ['e3a05aed-8dff-4f4d-9969-86f52076b29d', { category: 'PowerStrip', ...strip(4, 0, 2, 'https://item.rakuten.co.jp/e-zoa/itm0015826128/') }],
  ['b765834b-50f0-4096-b3ef-ef657ffab435', { category: 'PowerStrip', ...strip(4, 1, 1, 'https://item.rakuten.co.jp/styledmart/styled-ptp4u2-pd20-w/') }],
  ['0cbe8fcb-67c3-4049-8c1e-be1f232b6b35', { category: 'PowerStrip', ...strip(4, 0, 2, 'https://item.rakuten.co.jp/styledmart/styled-stp4ua2b-1/') }],
  ['6204991b-d1ba-4df6-b7a5-53c1e81a6cb4', { category: 'PowerStrip', ...strip(4, 0, 2, 'https://item.rakuten.co.jp/styledmart/styled-wst4p2uw-1/') }],
  ['161d64d5-c8c8-4a4c-af89-5f0e9b3f19e9', { category: 'PowerStrip', ...strip(4, 0, 2, 'https://item.rakuten.co.jp/styledmart/styled-ptp4u2-48a2/') }],
  ['77b156e9-0b38-4cdd-a3bd-c7a2909b1cbc', { category: 'PowerStrip', ...strip(6, 0, 2, 'https://item.rakuten.co.jp/styledmart/styled-stp6ua2w-2x2/') }],
  ['561da8a3-2d1a-4b22-8a37-5ab413ea5b63', { category: 'PowerStrip', ...strip(6, 0, 2, 'https://item.rakuten.co.jp/styledmart/styled-stp6ua2w-2/') }],
  ['5738739b-be4a-4979-bb7a-6c42f20d368f', { category: 'PowerStrip', ...strip(10, 0, 0, 'https://www.elecom.co.jp/products/ECT-0103BK.html') }],
  ['41bf07d5-947b-41ee-b734-993d6182f9e4', { category: 'PowerStrip', ...strip(6, 0, 0, 'https://item.rakuten.co.jp/rakuten24/e471437h/') }],
  ['0dc1b6db-b82c-46d9-9b8f-51cc55c00014', { category: 'PowerStrip', ...strip(6, 0, 0, 'https://item.rakuten.co.jp/rakuten24/e471420h/') }],
])

function summary(ports: Port[]): object {
  return ports.map(({ type, direction, count: portCount, label }) => ({
    type,
    direction,
    count: portCount,
    ...(label ? { label } : {}),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const ids = [...SPECS.keys()]
  const { data, error } = await db
    .from('products')
    .select('id,name,category,ports,specs_source_url,specs_verified_at')
    .in('id', ids)
  if (error) throw new Error(`更新対象の取得に失敗: ${error.message}`)
  if (!data || data.length !== ids.length) throw new Error(`更新対象が不足しています: ${data?.length ?? 0}/${ids.length}`)

  const updates = data.map((product) => {
    const spec = SPECS.get(product.id)!
    if (product.category !== spec.category) throw new Error(`カテゴリ不一致: ${product.name}`)
    return {
      id: product.id,
      name: product.name,
      category: spec.category,
      ports: spec.ports,
      specs_source_url: spec.sourceUrl,
      specs_verified_at: new Date().toISOString(),
    }
  })

  if (process.argv.includes('--verify')) {
    const mismatches = updates.filter((update) => {
      const stored = data.find((product) => product.id === update.id)!
      return JSON.stringify(summary(stored.ports as Port[])) !== JSON.stringify(summary(update.ports))
        || stored.specs_source_url !== update.specs_source_url
        || !stored.specs_verified_at
    })
    if (mismatches.length) throw new Error(`検証不一致: ${mismatches.map((item) => item.name).join(', ')}`)
    console.log(`${updates.length}件のDB端子仕様を検証しました`)
    return
  }

  console.log(JSON.stringify(updates.map((update) => ({
    id: update.id,
    category: update.category,
    name: update.name,
    ports: summary(update.ports),
    sourceUrl: update.specs_source_url,
  })), null, 2))
  if (!process.argv.includes('--apply')) {
    console.log(`dry-run: ${updates.length}件（書き込みなし）`)
    return
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `power-product-ports-before-update-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(data, null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  for (const update of updates) {
    const { error: updateError } = await db.from('products').update({
      ports: update.ports,
      specs_source_url: update.specs_source_url,
      specs_verified_at: update.specs_verified_at,
    }).eq('id', update.id)
    if (updateError) throw new Error(`${update.name} の更新に失敗: ${updateError.message}`)
  }
  console.log(`${updates.length}件の電源商品仕様を更新しました`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
