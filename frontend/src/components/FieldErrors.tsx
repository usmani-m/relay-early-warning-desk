export function FieldErrors({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <div role="alert">
      {messages.map((m) => (
        <p key={m} className="field-error">
          {m}
        </p>
      ))}
    </div>
  );
}
