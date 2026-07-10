// Codex 风格「思考中」气泡:assistant 气泡内三个跳动圆点 + 文案
export function ThinkingBubble(): JSX.Element {
  return (
    <div className="thinking-bubble">
      <span className="thinking-dots">
        <span />
        <span />
        <span />
      </span>
      <span className="thinking-text">思考中</span>
    </div>
  )
}
