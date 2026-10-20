export default function HomePage() {
  const intentionalTypeError: number = "ci-red-check-type-error";
  return (
    <main data-check={intentionalTypeError}>
      <h1>Event Registration System</h1>
    </main>
  );
}
