import type { CoachStep } from '../hooks/useCoachMarks'

// AIコーチの「？」。履歴の削除はスワイプ、回答のコピーは長押しで、どちらも画面に印が無い。
// 番号は渡した順に振られるので画面の上から並べる。画面に無い対象（履歴0件の行・添付していないデスク）は飛ばされる

export const AI_COACH_LIST_COACH: CoachStep[] = [
  { target: 'ai-usage', title: { ja: 'AIの利用枠', en: 'AI allowance' }, pad: 0, ja: 'AIコーチはProプランの機能です。Proでは週ごとに利用枠があり、使った割合とリセット日をここに出します。', en: 'The AI coach is a Pro feature. Pro has a weekly allowance; how much you have used and when it resets appear here.' },
  { target: 'ai-new-chat', title: { ja: '新しいチャット', en: 'New chat' }, pad: 0, ja: '新しい相談を始めます。デスクや写真を添付して相談することもできます。', en: 'Start a new chat. You can attach a desk or a photo to ask about it.' },
  { target: 'ai-history-setting', title: { ja: '履歴の保存', en: 'Saving history' }, pad: 0, ja: '会話をこの端末に保存するかを切り替えます。オフにしても、保存済みの履歴は消えません。', en: 'Choose whether chats are saved on this device. Turning it off keeps chats already saved.' },
  { target: 'ai-conversation', title: { ja: '相談履歴', en: 'Chat history' }, emphasis: { ja: ['タップ', '左へスワイプ'], en: ['Tap', 'Swipe left'] }, pad: 0, ja: '・タップ：続きから相談\n・左へスワイプ：削除（直後なら「元に戻す」で戻せます）', en: '• Tap: continue the chat\n• Swipe left: delete (Undo right after brings it back)' },
]

// 回答の行は一覧の枠で切る。入力欄の裏へ流れた回答を指さない
const inMessages = (steps: CoachStep[]): CoachStep[] => steps.map(step => ({ within: 'ai-messages', ...step }))

export const AI_COACH_CHAT_COACH: CoachStep[] = [
  { target: 'ai-history', title: { ja: '相談履歴', en: 'Chat history' }, pad: 2, header: true, ja: 'これまでの相談の一覧を開きます。', en: 'Open your past chats.' },
  { target: 'ai-new-conversation', title: { ja: '新しい会話', en: 'New chat' }, pad: 2, header: true, ja: '今の会話を閉じて、新しい相談を始めます。履歴を保存する設定なら、今の会話は履歴から開き直せます。', en: 'Close this chat and start a new one. With history saving on, you can reopen this chat from your history.' },
  ...inMessages([
    { target: 'ai-answer', title: { ja: 'AIの回答', en: 'AI responses' }, emphasis: { ja: ['長押し'], en: ['Hold'] }, pad: 0, ja: '回答を長押しすると、全文をコピーします。', en: 'Hold a response to copy all of it.' },
    { target: 'ai-answer-actions', title: { ja: '回答の操作', en: 'Response actions' }, pad: 4, ja: 'コピー・もう一度回答させる・報告ができます。「もう一度」は最後の回答にだけ出て、AIの利用枠を使います。', en: 'Copy, regenerate, or report. Regenerate appears only on the latest response and uses your AI allowance.' },
  ]),
  { target: 'ai-suggestions', title: { ja: '相談の例', en: 'Suggested questions' }, pad: 4, ja: '選ぶとその内容で相談します。デスクがあれば、先にどのデスクについての相談かを選びます。', en: 'Pick one to ask it. If you have desks, choose which desk it is about first.' },
  { target: 'ai-desk-context', title: { ja: 'AIへ送る情報', en: 'Data sent to AI' }, pad: 4, ja: '添付したデスクのうち、AIへ送る情報を選び直せます。横の×で添付を外します。', en: 'Choose which details of the attached desk are sent to the AI. Use × next to it to remove the desk.' },
  { target: 'ai-attach-desk', title: { ja: 'デスクを添付', en: 'Attach a desk' }, pad: 2, ja: 'デスクを選んで添付すると、その機材と配線をもとに答えます。', en: 'Attach a desk to get answers based on its gear and wiring.' },
  { target: 'ai-attach-photo', title: { ja: '写真を添付', en: 'Attach a photo' }, pad: 2, ja: 'デスクの写真を添付して相談できます。', en: 'Attach a photo of your desk to ask about it.' },
  { target: 'ai-send', title: { ja: '送信・停止', en: 'Send or stop' }, pad: 2, ja: '相談を送ります。回答の途中は停止ボタンに替わり、押すとそこで止まります。', en: 'Send your message. While the AI is answering, this becomes a stop button.' },
]
