import { Errors } from '../common/app-error';
import type { Database } from '../database/database.module';
import type { RequestUser } from '../common/request-user';

/**
 * Turns the user's scope for a permission into a concrete row filter (requirements 5.3).
 *  all                      -> every student
 *  class / section          -> sections where the user is class teacher this year
 *  subject / assigned_*     -> sections the user teaches this year
 *  own_children             -> students of the user's family
 *  own_records              -> the student linked to the user (college login)
 */
export type StudentFilter =
  | { kind: 'all' }
  | { kind: 'sections'; sectionIds: number[] }
  | { kind: 'family'; userId: number }
  | { kind: 'self'; userId: number }
  | { kind: 'none' };

export async function studentFilter(db: Database, user: RequestUser, permission: string, yearId: number): Promise<StudentFilter> {
  const scope = user.permissions.get(permission);
  if (!scope) return { kind: 'none' };
  switch (scope) {
    case 'all':
      return { kind: 'all' };
    case 'class':
    case 'section': {
      const rows = await db.selectFrom('class_teachers as ct').innerJoin('staff as s', 's.id', 'ct.staff_id')
        .select('ct.section_id').where('s.user_id', '=', user.id).where('ct.academic_year_id', '=', yearId).execute();
      return { kind: 'sections', sectionIds: rows.map((r) => r.section_id) };
    }
    case 'subject':
    case 'assigned_students': {
      const rows = await db.selectFrom('teacher_assignments as ta').innerJoin('staff as s', 's.id', 'ta.staff_id')
        .select('ta.section_id').distinct().where('s.user_id', '=', user.id).where('ta.academic_year_id', '=', yearId).execute();
      return { kind: 'sections', sectionIds: rows.map((r) => r.section_id) };
    }
    case 'own_children':
      return { kind: 'family', userId: user.id };
    case 'own_records':
      return { kind: 'self', userId: user.id };
    default:
      return { kind: 'none' }; // assigned_route etc. arrive with their modules
  }
}

/** Returns the internal id of a student the user may see under `permission`, or throws NOT_FOUND. */
export async function visibleStudentId(db: Database, user: RequestUser, studentPublicId: string, permission: string, yearId: number) {
  const f = await studentFilter(db, user, permission, yearId);
  let q = db.selectFrom('students as s').innerJoin('families as fa', 'fa.id', 's.family_id')
    .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').on('e.academic_year_id', '=', yearId))
    .select('s.id').where('s.public_id', '=', studentPublicId);
  if (f.kind === 'sections') q = f.sectionIds.length ? q.where('e.section_id', 'in', f.sectionIds) : q.where('s.id', '=', -1);
  else if (f.kind === 'family') q = q.where('fa.user_id', '=', f.userId);
  else if (f.kind === 'self') q = q.where('s.user_id', '=', f.userId);
  else if (f.kind === 'none') q = q.where('s.id', '=', -1);
  const row = await q.executeTakeFirst();
  if (!row) throw Errors.notFound('Student');
  return row.id;
}
