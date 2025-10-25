'use strict';

module.exports = {
  async up(queryInterface) {
    const qi = queryInterface;
    const sql = (s, t) => qi.sequelize.query(s, { transaction: t });

    await qi.sequelize.transaction(async (t) => {
      /* A) Remove orphan schedules (no parent loan) */
      await sql(`
        delete from public.loan_schedules s
        where not exists (select 1 from public.loans l where l.id = s.loan_id);
      `, t);

      /* B) Ensure FK exists (idempotent), cascade on delete */
      await sql(`
        do $$
        begin
          if not exists (
            select 1
            from   pg_constraint
            where  conname  = 'fk_schedules_loan'
            and    conrelid = 'public.loan_schedules'::regclass
          ) then
            alter table public.loan_schedules
              add constraint fk_schedules_loan
              foreign key (loan_id) references public.loans(id)
              on delete cascade
              deferrable initially immediate;
          end if;
        end$$;
      `, t);

      /* C) Backfill next due date/amount (NO window-in-filter) */

      /* Option 1: DISTINCT ON (simplest & fast) */
      await sql(`
        with nexts as (
          select distinct on (loan_id)
                 loan_id,
                 due_date  as next_due_date,
                 total     as next_due_amount
          from public.loan_schedules
          where coalesce(paid, 0)::numeric = 0
          order by loan_id, due_date asc
        )
        update public."loans" l
        set "nextDueDate"   = n.next_due_date,
            "nextDueAmount" = n.next_due_amount
        from nexts n
        where n.loan_id = l.id;
      `, t);

      /* Option 2 (fallback alternative): join to min-date per loan
         -- Keep commented for reference. Works the same if you prefer:
         with mins as (
           select loan_id, min(due_date) as min_due
           from public.loan_schedules
           where coalesce(paid, 0)::numeric = 0
           group by loan_id
         ),
         nexts as (
           select ls.loan_id, ls.due_date as next_due_date, ls.total as next_due_amount
           from public.loan_schedules ls
           join mins m on m.loan_id = ls.loan_id and ls.due_date = m.min_due
           where coalesce(ls.paid, 0)::numeric = 0
         )
         update public."loans" l
         set "nextDueDate" = n.next_due_date,
             "nextDueAmount" = n.next_due_amount
         from nexts n
         where n.loan_id = l.id;
      */

      /* D) Plain column indexes (no IMMUTABLE needed) */
      await sql(`
        -- loans
        create index if not exists idx_loans_disb_date       on public."loans" (disbursement_date);
        create index if not exists idx_loans_disbdate_camel  on public."loans" ("disbursementDate");
        create index if not exists idx_loans_startdate       on public."loans" ("startDate");
        create index if not exists idx_loans_status          on public."loans" (status);
        create index if not exists idx_loans_branch          on public."loans" ("branchId");
        create index if not exists idx_loans_product_snake   on public."loans" (product_id);
        create index if not exists idx_loans_product_camel   on public."loans" ("productId");

        -- loan_schedules
        create index if not exists idx_sched_loan on public.loan_schedules (loan_id);
        create index if not exists idx_sched_due  on public.loan_schedules (due_date);
        create index if not exists idx_sched_paid on public.loan_schedules (paid);

        -- loan_payments
        create index if not exists idx_pay_loan          on public.loan_payments ("loanId");
        create index if not exists idx_pay_payment_date  on public.loan_payments ("paymentDate");
        create index if not exists idx_pay_date_date     on public.loan_payments ("date");
        create index if not exists idx_pay_status        on public.loan_payments (status);
        create index if not exists idx_pay_applied       on public.loan_payments (applied);
      `, t);
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    const sql = (s) => qi.sequelize.query(s);

    await sql(`drop index if exists idx_loans_disb_date;`);
    await sql(`drop index if exists idx_loans_disbdate_camel;`);
    await sql(`drop index if exists idx_loans_startdate;`);
    await sql(`drop index if exists idx_loans_status;`);
    await sql(`drop index if exists idx_loans_branch;`);
    await sql(`drop index if exists idx_loans_product_snake;`);
    await sql(`drop index if exists idx_loans_product_camel;`);

    await sql(`drop index if exists idx_sched_loan;`);
    await sql(`drop index if exists idx_sched_due;`);
    await sql(`drop index if exists idx_sched_paid;`);

    await sql(`drop index if exists idx_pay_loan;`);
    await sql(`drop index if exists idx_pay_payment_date;`);
    await sql(`drop index if exists idx_pay_date_date;`);
    await sql(`drop index if exists idx_pay_status;`);
    await sql(`drop index if exists idx_pay_applied;`);
    // (We keep the FK unless you explicitly want it dropped.)
  }
};
