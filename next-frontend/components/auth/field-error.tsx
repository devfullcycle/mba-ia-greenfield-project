function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-caption text-destructive">{message}</p>
}

export { FieldError }
