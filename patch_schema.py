import re

path = "backend/prisma/schema.prisma"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old_stage_assignment = '''model StageAssignment {
  id               String   @id @default(uuid())
  projectId        String   @map("project_id")
  stageKey         StageKey @map("stage_key")
  assignedMemberId String   @map("assigned_member_id")
  assignedBy       String   @map("assigned_by")
  assignedAt       DateTime @default(now()) @map("assigned_at")

  project        Project            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  assignedMember OrganizationMember @relation(fields: [assignedMemberId], references: [id])

  @@unique([projectId, stageKey])
  @@index([assignedMemberId])
  @@map("stage_assignments")
}'''

new_stage_assignment = '''model StageAssignment {
  id               String   @id @default(uuid())
  projectId        String   @map("project_id")
  stageKey         StageKey @map("stage_key")
  // V1.2 (team assignment): salah satu dari dua ini terisi, tidak keduanya/kosong
  // (ditegakkan di StagesService, plus CHECK constraint di database).
  assignedMemberId String?  @map("assigned_member_id")
  assignedTeamId   String?  @map("assigned_team_id")
  assignedBy       String   @map("assigned_by")
  assignedAt       DateTime @default(now()) @map("assigned_at")

  project        Project             @relation(fields: [projectId], references: [id], onDelete: Cascade)
  assignedMember OrganizationMember? @relation(fields: [assignedMemberId], references: [id])
  assignedTeam   Team?               @relation(fields: [assignedTeamId], references: [id])

  @@unique([projectId, stageKey])
  @@index([assignedMemberId])
  @@index([assignedTeamId])
  @@map("stage_assignments")
}'''

if old_stage_assignment not in content:
    raise SystemExit("TIDAK KETEMU blok StageAssignment lama — schema.prisma sudah berubah dari yang diharapkan, edit manual saja.")
content = content.replace(old_stage_assignment, new_stage_assignment)

old_team = '''  members TeamMember[]

  @@index([organizationId])
  @@map("teams")
}'''

new_team = '''  members TeamMember[]
  stageAssignments StageAssignment[]

  @@index([organizationId])
  @@map("teams")
}'''

if old_team not in content:
    raise SystemExit("TIDAK KETEMU blok Team lama — schema.prisma sudah berubah dari yang diharapkan, edit manual saja.")
content = content.replace(old_team, new_team)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Berhasil: schema.prisma sudah diperbarui (StageAssignment + Team).")
