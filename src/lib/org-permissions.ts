import { NextResponse } from "next/server";

export const ORG_ROLE_OWNER = "owner";

export type OrgMember = {
  organization_id: string;
  role: string;
};

export function isOrgOwner(member: OrgMember | null | undefined): boolean {
  return member?.role === ORG_ROLE_OWNER;
}

/** Respuesta 403 si no hay membresía o el rol no es owner (solo administradores pueden mutar datos). */
export function denyIfNotOwner(
  member: OrgMember | null,
): NextResponse | null {
  if (!member) {
    return NextResponse.json({ error: "Sin organización" }, { status: 403 });
  }
  if (!isOrgOwner(member)) {
    return NextResponse.json(
      {
        error:
          "Solo el administrador de la organización (rol owner) puede modificar o importar datos.",
      },
      { status: 403 },
    );
  }
  return null;
}
