-- C1 final-state check. Run against the database kept by:
--   KEEP_TEST_DB=1 ... registrations.concurrency.test.ts
-- This reads the FINAL database state only; it says nothing about intermediate states.
-- Expected: confirmed=10, waitlisted=40, total=50, every flag below = true.
\echo '=== C1 event: registrations by status ==='
SELECT e.title, e.capacity, r.status, count(*) AS n
FROM events e
JOIN registrations r ON r.event_id = e.id AND r.organization_id = e.organization_id
WHERE e.title = 'C1 10-Spot Event'
GROUP BY e.title, e.capacity, r.status
ORDER BY r.status;

\echo '=== invariants INV-1 / INV-2 / INV-3 and seq checks (expect all true) ==='
WITH ev AS (
  SELECT id, capacity FROM events WHERE title = 'C1 10-Spot Event'
), reg AS (
  SELECT r.* FROM registrations r JOIN ev ON ev.id = r.event_id
), agg AS (
  SELECT
    (SELECT capacity FROM ev) AS capacity,
    count(*) FILTER (WHERE status = 'confirmed') AS confirmed,
    count(*) FILTER (WHERE status = 'waitlisted') AS waitlisted,
    count(*) AS total,
    count(DISTINCT seq) AS distinct_seq,
    max(seq) FILTER (WHERE status = 'confirmed') AS max_confirmed_seq,
    min(seq) FILTER (WHERE status = 'waitlisted') AS min_waitlisted_seq
  FROM reg
), dup AS (
  SELECT count(*) AS dup_users FROM (
    SELECT user_id FROM reg
    WHERE status IN ('confirmed', 'waitlisted')
    GROUP BY user_id
    HAVING count(*) > 1
  ) d
)
SELECT
  agg.capacity, agg.confirmed, agg.waitlisted, agg.total,
  (agg.confirmed <= agg.capacity)                         AS inv1_confirmed_le_capacity,
  (agg.waitlisted = 0 OR agg.confirmed = agg.capacity)    AS inv2_waitlist_implies_full,
  (dup.dup_users = 0)                                     AS inv3_no_duplicate_active,
  (agg.distinct_seq = agg.total)                          AS seq_all_distinct,
  (agg.max_confirmed_seq < agg.min_waitlisted_seq)        AS confirmed_seq_before_waitlisted
FROM agg, dup;
