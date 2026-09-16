// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { reconcileStatusSearchSchema } from '@/routes/_authenticated/_layout/super-admin/accounts/import-enterprise/$jobId';
import { ReconcileEmailsCard } from '../reconcile-emails-card';
import { reconcileGateway, type ReconcileSessionProgress } from '../reconcile-gateway';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
  }),
}));

vi.mock('../reconcile-gateway', () => ({
  reconcileGateway: {
    getSession: vi.fn(),
    itemsPage: vi.fn(),
    ambiguousPage: vi.fn(),
  },
}));

const gateway = vi.mocked(reconcileGateway);

function progress(overrides: {
  auto?: Partial<ReconcileSessionProgress['auto']>;
  ambiguous?: Partial<ReconcileSessionProgress['ambiguous']>;
}): ReconcileSessionProgress {
  const auto = { applied: 0, skipped: 0, failed: 0, conflict: 0, pending: 0, ...overrides.auto };
  const ambiguous = { applied: 0, skipped: 0, pending: 0, failed: 0, conflict: 0, ...overrides.ambiguous };
  return {
    jobId: 'job-1',
    csvRows: 10,
    invalidCsvRows: 0,
    contactsMasked: 10,
    alreadyClean: 0,
    noMatches: 0,
    noMatchSample: [],
    auto: { ...auto, total: auto.applied + auto.skipped + auto.failed + auto.conflict + auto.pending },
    ambiguous: {
      ...ambiguous,
      total: ambiguous.applied + ambiguous.skipped + ambiguous.pending + ambiguous.failed + ambiguous.conflict,
    },
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
  };
}

// Mirrors the real route id so the card's getRouteApi() resolves against it.
function renderCard(initialUrl: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const authenticated = createRoute({ getParentRoute: () => rootRoute, id: '_authenticated', component: Outlet });
  const layout = createRoute({ getParentRoute: () => authenticated, id: '_layout', component: Outlet });
  const statusRoute = createRoute({
    getParentRoute: () => layout,
    path: 'super-admin/accounts/import-enterprise/$jobId',
    validateSearch: reconcileStatusSearchSchema,
    component: () => <ReconcileEmailsCard jobId="job-1" />,
  });
  const history = createMemoryHistory({ initialEntries: [initialUrl] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([authenticated.addChildren([layout.addChildren([statusRoute])])]),
    history,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, history };
}

const BASE = '/super-admin/accounts/import-enterprise/job-1';

const search = (router: ReturnType<typeof renderCard>['router']) =>
  router.state.location.search as Record<string, unknown>;

async function searchInputs() {
  // ItemsSection renders first, the review queue second.
  const inputs = await screen.findAllByPlaceholderText('superAdmin.accounts.import.reconcile.searchPlaceholder');
  return { items: inputs[0] as HTMLInputElement, review: inputs[inputs.length - 1] as HTMLInputElement };
}

beforeEach(() => {
  // Router scroll restoration calls it on every navigation; jsdom lacks it.
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  gateway.itemsPage.mockResolvedValue({ total: 0, offset: 0, items: [] });
  gateway.ambiguousPage.mockImplementation(async (_jobId, offset) => ({
    totalPending: 1,
    offset,
    items: [
      {
        contactId: 7,
        currentEmail: 'maria***@gmail.com',
        contactName: 'Maria Silva',
        candidates: [{ csvRowNumber: 3, csvName: 'Maria Silva', csvEmail: 'maria.silva@gmail.com', score: 1 }],
        candidatesTotal: 1,
      },
    ],
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReconcileEmailsCard review queue', () => {
  it('shows the review queue and bulk actions for a session whose only open work is an auto conflict', async () => {
    gateway.getSession.mockResolvedValue(progress({ auto: { applied: 4, conflict: 1 } }));
    renderCard(BASE);

    expect(
      await screen.findByText(/superAdmin\.accounts\.import\.reconcile\.ambiguousPendingHeader \{"pending":"1"\}/),
    ).toBeTruthy();
    expect(screen.queryByText(/ambiguousAllDone/)).toBeNull();
    expect(await screen.findByText('Maria Silva')).toBeTruthy();
    expect(screen.getByText('superAdmin.accounts.import.reconcile.skipRemaining')).toBeTruthy();
    // Best-name only sweeps undecided ambiguous items, and there are none.
    expect(
      (screen.getByText('superAdmin.accounts.import.reconcile.bulkBestName').closest('button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('counts ambiguous conflicts as review work too', async () => {
    gateway.getSession.mockResolvedValue(progress({ ambiguous: { applied: 2, conflict: 1 } }));
    renderCard(BASE);

    expect(await screen.findByText(/ambiguousPendingHeader \{"pending":"1"\}/)).toBeTruthy();
    expect(screen.queryByText(/ambiguousAllDone/)).toBeNull();
  });

  it('keeps the review queue mounted as done after the only auto conflict is skipped', async () => {
    gateway.getSession.mockResolvedValue(progress({ auto: { pending: 3, skipped: 1 } }));
    renderCard(BASE);

    expect(await screen.findByText(/ambiguousAllDone \{"applied":"0","skipped":"1"\}/)).toBeTruthy();
    expect(screen.queryByText('superAdmin.accounts.import.reconcile.skipRemaining')).toBeNull();
  });

  it('reports the queue as done once nothing is pending or conflicting', async () => {
    gateway.getSession.mockResolvedValue(progress({ auto: { applied: 4 }, ambiguous: { applied: 2, skipped: 1 } }));
    renderCard(BASE);

    expect(await screen.findByText(/ambiguousAllDone/)).toBeTruthy();
    expect(screen.queryByText('superAdmin.accounts.import.reconcile.skipRemaining')).toBeNull();
  });
});

describe('ReconcileEmailsCard search state in the URL', () => {
  beforeEach(() => {
    gateway.getSession.mockResolvedValue(progress({ ambiguous: { pending: 1 } }));
  });

  it('keeps the restored page offset instead of resetting it on mount', async () => {
    const { router } = renderCard(`${BASE}?ambQ=maria&ambOffset=25&itemsQ=silva&itemsOffset=50`);

    const { items, review } = await searchInputs();
    expect(review.value).toBe('maria');
    expect(items.value).toBe('silva');

    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(search(router)).toMatchObject({ ambQ: 'maria', ambOffset: 25, itemsQ: 'silva', itemsOffset: 50 });
    expect(gateway.ambiguousPage).not.toHaveBeenCalledWith('job-1', 0, expect.anything(), expect.anything());
  });

  it('follows back/forward in both search boxes', async () => {
    const { router, history } = renderCard(BASE);
    const { items, review } = await searchInputs();

    fireEvent.change(review, { target: { value: 'ana' } });
    await waitFor(() => expect(search(router).ambQ).toBe('ana'));
    fireEvent.change(review, { target: { value: 'bia' } });
    await waitFor(() => expect(search(router).ambQ).toBe('bia'));

    fireEvent.change(items, { target: { value: 'carla' } });
    await waitFor(() => expect(search(router).itemsQ).toBe('carla'));

    act(() => history.back());
    await waitFor(() => expect(search(router).itemsQ).toBe(''));
    expect(items.value).toBe('');

    act(() => history.back());
    await waitFor(() => expect(search(router).ambQ).toBe('ana'));
    expect(review.value).toBe('ana');

    act(() => history.forward());
    await waitFor(() => expect(search(router).ambQ).toBe('bia'));
    expect(review.value).toBe('bia');

    // The box following the URL must not commit again (which would push a new
    // entry and drop the forward history).
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    act(() => history.forward());
    await waitFor(() => expect(search(router).itemsQ).toBe('carla'));
    expect(items.value).toBe('carla');
  });
});
