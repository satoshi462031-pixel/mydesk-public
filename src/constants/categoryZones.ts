import { DeskZone, GadgetCategory } from '../types'
import { TemplateSlot } from '../types/template'

// ─── ジャンルごとの初期の置き場所 ──────────────────────────────────────
//
// ジャンルから作っただけの枠（用途から入った枠・ジャンルを追加した枠）には置き場所が無い。zone を渡さなくても
// 配線図は resolveRow のカテゴリ既定で並ぶが、それは「机のどこにあるか」ではなく
// 「図のどの段に描くか」でしかなく、作成の配置の段が全部『未配置』から始まる。
// ここで代表的な置き場所を与えておき、動かしたい人だけ配置で直す形にする。
// 値は公式テンプレート（deskTemplates.ts）と PURPOSE_GADGETS で使っていた zone に揃えてある。

const DEFAULT_ZONE: Partial<Record<GadgetCategory, DeskZone>> = {
  Monitor: 'back_center',
  TV: 'wall_center',
  Projector: 'shelf',
  MonitorArm: 'back_center',
  Hub: 'desk_right',
  Dock: 'desk_right',
  Storage: 'desk_left',
  PCPart: 'under_desk',
  KVM: 'desk_right',
  CaptureDevice: 'desk_right',
  StreamingDevice: 'back_center',

  GameConsole: 'back_left',
  Controller: 'front_left',
  VRGlass: 'shelf',

  Mouse: 'front_right',
  MousePad: 'front_right',
  Keyboard: 'front_center',
  PenTablet: 'front_left',
  Webcam: 'back_center',
  Camera: 'shelf',
  Lens: 'shelf',
  Tripod: 'floor_left',
  Printer: 'shelf',
  Printer3D: 'shelf',

  Headphone: 'desk_right',
  Earphone: 'desk_right',
  Speaker: 'back_left',
  Microphone: 'desk_right',
  MicArm: 'desk_right',
  AudioInterface: 'desk_left',
  HeadphoneAmp: 'desk_left',
  Amplifier: 'shelf',
  Mixer: 'desk_left',
  Instrument: 'desk_left',

  Smartphone: 'desk_right',
  Tablet: 'desk_right',
  Smartwatch: 'desk_right',

  Router: 'floor_left',
  NetworkSwitch: 'floor_left',
  Modem: 'floor_left',
  Charger: 'desk_right',
  MobileBattery: 'desk_right',
  PowerStrip: 'under_desk',
  UPS: 'under_desk',

  Light: 'desk_back',
  WallPanel: 'wall_center',
  DeskPad: 'front_center',
  SmartHome: 'desk_back',

  SmallDevice: 'desk_right',
  Accessory: 'desk_right',
  Plant: 'desk_left',
}

/**
 * ジャンル1つぶんの初期の置き場所。
 * PC だけは形で置き場所が変わる（ノートは机の上、デスクトップ・ミニは机の下）。
 * Desk / Chair / Furniture / Cable / Other は置き場所を持たない（図では枠の外）。
 */
export function defaultZoneForCategory(
  category: GadgetCategory,
  pcFormFactor?: TemplateSlot['pcFormFactor'],
): DeskZone | undefined {
  if (category === 'PC') return pcFormFactor === 'laptop' ? 'back_center' : 'under_desk'
  return DEFAULT_ZONE[category]
}
