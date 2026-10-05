export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex justify-center py-16">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
    </div>
  );
}
