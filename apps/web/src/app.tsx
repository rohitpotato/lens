import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { DashboardPage } from '@/routes/dashboard';
import { ReviewPage } from '@/routes/review';
import { RulesPage } from '@/routes/rules';
import { VendorsIndexPage } from '@/routes/vendors';
import { VendorDetailPage } from '@/routes/vendor-detail';
import { QueryPage } from '@/routes/query';
import { DocumentsPage } from '@/routes/documents';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

const router = createBrowserRouter([
  { path: '/', element: <DashboardPage /> },
  { path: '/review', element: <ReviewPage /> },
  { path: '/review/:documentId', element: <ReviewPage /> },
  { path: '/rules', element: <RulesPage /> },
  { path: '/vendors', element: <VendorsIndexPage /> },
  { path: '/vendors/:vendor', element: <VendorDetailPage /> },
  { path: '/query', element: <QueryPage /> },
  { path: '/documents', element: <DocumentsPage /> },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster richColors closeButton position="bottom-right" />
    </QueryClientProvider>
  );
}
