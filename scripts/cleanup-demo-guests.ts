import { prisma } from "@project-memory/db";

const retentionDays = Number(process.env.DEMO_GUEST_RETENTION_DAYS || 7);
const dryRun = process.argv.includes("--dry-run");
const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

async function cleanupGuestUser(userId: string) {
  const scopes = await prisma.projectScope.findMany({
    where: { userId },
    select: { id: true }
  });
  const scopeIds = scopes.map((scope) => scope.id);

  if (dryRun) {
    const [events, digests, states, working, reminders] = await Promise.all([
      prisma.memoryEvent.count({ where: { scopeId: { in: scopeIds } } }),
      prisma.digest.count({ where: { scopeId: { in: scopeIds } } }),
      prisma.digestStateSnapshot.count({ where: { scopeId: { in: scopeIds } } }),
      prisma.workingMemorySnapshot.count({ where: { scopeId: { in: scopeIds } } }),
      prisma.reminder.count({ where: { OR: [{ userId }, { scopeId: { in: scopeIds } }] } })
    ]);

    return {
      scopes: scopeIds.length,
      events,
      digests,
      states,
      working,
      reminders
    };
  }

  await prisma.$transaction([
    prisma.userState.deleteMany({ where: { userId } }),
    prisma.reminder.deleteMany({ where: { OR: [{ userId }, { scopeId: { in: scopeIds } }] } }),
    prisma.workingMemorySnapshot.deleteMany({ where: { scopeId: { in: scopeIds } } }),
    prisma.digestStateSnapshot.deleteMany({ where: { scopeId: { in: scopeIds } } }),
    prisma.digest.deleteMany({ where: { scopeId: { in: scopeIds } } }),
    prisma.memoryEvent.deleteMany({ where: { scopeId: { in: scopeIds } } }),
    prisma.projectScope.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } })
  ]);

  return {
    scopes: scopeIds.length
  };
}

async function main() {
  const guestUsers = await prisma.user.findMany({
    where: {
      identity: { startsWith: "user:demo-guest-" },
      createdAt: { lt: cutoff }
    },
    select: {
      id: true,
      identity: true,
      createdAt: true
    },
    orderBy: { createdAt: "asc" }
  });

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "apply",
        retentionDays,
        cutoff: cutoff.toISOString(),
        guestUsers: guestUsers.length
      },
      null,
      2
    )
  );

  let cleanedScopes = 0;
  let cleanedEvents = 0;
  let cleanedDigests = 0;
  let cleanedStates = 0;
  let cleanedWorking = 0;
  let cleanedReminders = 0;

  for (const user of guestUsers) {
    const result = await cleanupGuestUser(user.id);
    cleanedScopes += result.scopes;
    cleanedEvents += "events" in result ? result.events : 0;
    cleanedDigests += "digests" in result ? result.digests : 0;
    cleanedStates += "states" in result ? result.states : 0;
    cleanedWorking += "working" in result ? result.working : 0;
    cleanedReminders += "reminders" in result ? result.reminders : 0;
  }

  console.log(
    JSON.stringify(
      {
        guestUsers: guestUsers.length,
        cleanedScopes,
        cleanedEvents,
        cleanedDigests,
        cleanedStates,
        cleanedWorking,
        cleanedReminders
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
