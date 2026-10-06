export type OrganizationProfile = {
  id: string;
  name: string;
  rut: string;
  giro: string;
  address: string;
  comuna: string;
  phone: string;
  contactEmail: string;
  representative: string;
  website: string;
};

export type OrganizationProfileInput = Omit<OrganizationProfile, "id">;

export const EMPTY_ORGANIZATION_PROFILE: OrganizationProfileInput = {
  name: "",
  rut: "",
  giro: "",
  address: "",
  comuna: "",
  phone: "",
  contactEmail: "",
  representative: "",
  website: "",
};

function trimField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseOrganizationProfileInput(
  body: Record<string, unknown>,
): { ok: true; data: OrganizationProfileInput } | { ok: false; error: string } {
  const name = trimField(body.name);
  if (!name) {
    return { ok: false, error: "La razón social o nombre de la empresa es obligatorio." };
  }

  const contactEmail = trimField(body.contactEmail ?? body.contact_email);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { ok: false, error: "El email de contacto no es válido." };
  }

  return {
    ok: true,
    data: {
      name,
      rut: trimField(body.rut),
      giro: trimField(body.giro),
      address: trimField(body.address),
      comuna: trimField(body.comuna),
      phone: trimField(body.phone),
      contactEmail,
      representative: trimField(body.representative),
      website: trimField(body.website),
    },
  };
}

export function organizationProfileFromRow(row: Record<string, unknown>): OrganizationProfile {
  return {
    id: String(row.id ?? ""),
    name: trimField(row.name),
    rut: trimField(row.rut),
    giro: trimField(row.giro),
    address: trimField(row.address),
    comuna: trimField(row.comuna),
    phone: trimField(row.phone),
    contactEmail: trimField(row.contact_email),
    representative: trimField(row.representative),
    website: trimField(row.website),
  };
}

export function organizationProfileToDb(
  profile: OrganizationProfileInput,
): Record<string, string> {
  return {
    name: profile.name,
    rut: profile.rut,
    giro: profile.giro,
    address: profile.address,
    comuna: profile.comuna,
    phone: profile.phone,
    contact_email: profile.contactEmail,
    representative: profile.representative,
    website: profile.website,
  };
}
