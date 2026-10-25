import assert from 'node:assert/strict'
import { computeMetrics } from '../src/api.ts'
const old={id:1,work_id:'work-1',version:8,status:'approved',teacher_id:1,group_id:'g1',month:'2026-10',hours_cent:400,supersedes_id:null}
const correction={...old,id:2,version:1,status:'draft',hours_cent:600,supersedes_id:1}
const scope={month:'2026-10',teacherId:1,groupId:'all'}
assert.equal(computeMetrics([], [old,correction],scope).declaredCent,600,'new revision wins even when edit version is lower')
assert.equal(computeMetrics([], [old,correction],scope).approvedCent,400)
assert.equal(computeMetrics([], [old,{...correction,status:'returned'}],scope).declaredCent,400)
assert.equal(computeMetrics([], [old,{...correction,month:'2026-09',teacher_id:2}],scope).declaredCent,0,'choose latest work before filtering moved scope')
assert.equal(computeMetrics([], [{...old,status:'superseded'},{...correction,status:'approved'}],scope).approvedCent,600)
console.log('UI metrics: correction, return, moved scope and approval passed')

assert.equal(computeMetrics([], [{...old,is_current_claimed:false}],scope).declaredCent,0,'server canonical flag resolves hidden cross-teacher correction')
assert.equal(computeMetrics([], [{...correction,status:'returned',is_current_claimed:false}],scope).declaredCent,0,'returned correction with hidden original is not claimed')
