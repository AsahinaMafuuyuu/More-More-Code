import { db } from "./client.ts";

export class PrismaEventStore {
  private async nextSequence() {
    const latest = await db.runtimeEvent.findFirst({
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });

    return (latest?.sequence ?? 0) + 1;
  }

  async append(input: { sessionId?: string; type: string; payload: unknown }) {
    const sequence = await this.nextSequence();

    return db.runtimeEvent.create({
      data: {
        sessionId: input.sessionId,
        type: input.type,
        payload: input.payload as any,
        sequence,
      },
    });
  }

  async listAfter(sequence: number) {
    return db.runtimeEvent.findMany({
      where: { sequence: { gt: sequence } },
      orderBy: { sequence: "asc" },
    });
  }

  async createSnapshot(input: { sessionId?: string; eventOffset: number; state: unknown }) {
    return db.runtimeSnapshot.create({
      data: {
        sessionId: input.sessionId,
        eventOffset: input.eventOffset,
        state: input.state as any,
      },
    });
  }

  async latestSnapshot(sessionId?: string) {
    return db.runtimeSnapshot.findFirst({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    });
  }
}
