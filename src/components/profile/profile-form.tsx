"use client";

import { Loader2, Save } from "lucide-react";
import * as React from "react";

import { FormField } from "@/components/auth/form-field";
import { NoPrefillInput } from "@/components/auth/no-prefill-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ProfileFormValues {
  name: string;
  phone: string;
  country: string;
  city: string;
  timezone: string;
  bio: string;
}

/**
 * Profile editor. The browser only collects input; every value is validated again
 * on the server (`updateProfileSchema`) and the change is written together with an
 * audit entry, so a tampered request cannot bypass the rules.
 */
export function ProfileForm({ initial }: { initial: ProfileFormValues }) {
  const [values, setValues] = React.useState<ProfileFormValues>(initial);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [message, setMessage] = React.useState<string | null>(null);

  function update(field: keyof ProfileFormValues) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [field]: event.target.value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          phone: values.phone,
          country: values.country,
          city: values.city,
          timezone: values.timezone,
          bio: values.bio,
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Profil tidak dapat disimpan saat ini.");
        setFieldErrors(payload.fieldErrors ?? {});
        return;
      }

      setMessage("Profil tersimpan. Perubahan juga tercatat pada jejak audit.");
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error ? (
        <Alert variant="danger" title="Penyimpanan gagal">
          {error}
        </Alert>
      ) : null}
      {message ? (
        <Alert variant="success" title="Berhasil">
          {message}
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* The editor already holds the saved values, so the browser must not type
            its own profile over them: Chrome/Edge autofill personal fields on load
            and would show a name nobody in this account ever saved. */}
        <FormField label="Nama tampilan" htmlFor="profile-name" error={fieldErrors.name}>
          <NoPrefillInput
            id="profile-name"
            name="name"
            autoComplete="name"
            value={values.name}
            onChange={update("name")}
          />
        </FormField>

        <FormField label="Nomor telepon" htmlFor="profile-phone" error={fieldErrors.phone}>
          <NoPrefillInput
            id="profile-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={values.phone}
            onChange={update("phone")}
          />
        </FormField>

        <FormField label="Negara" htmlFor="profile-country" error={fieldErrors.country}>
          <NoPrefillInput
            id="profile-country"
            name="country"
            autoComplete="country-name"
            value={values.country}
            onChange={update("country")}
          />
        </FormField>

        <FormField label="Kota" htmlFor="profile-city" error={fieldErrors.city}>
          <NoPrefillInput
            id="profile-city"
            name="city"
            autoComplete="address-level2"
            value={values.city}
            onChange={update("city")}
          />
        </FormField>

        <FormField
          label="Zona waktu"
          htmlFor="profile-timezone"
          error={fieldErrors.timezone}
          hint="Contoh: Asia/Jakarta"
        >
          <Input
            id="profile-timezone"
            name="timezone"
            value={values.timezone}
            onChange={update("timezone")}
          />
        </FormField>

        <FormField label="Bio singkat" htmlFor="profile-bio" error={fieldErrors.bio}>
          <Input id="profile-bio" name="bio" value={values.bio} onChange={update("bio")} />
        </FormField>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
        {pending ? "Menyimpan..." : "Simpan profil"}
      </Button>
    </form>
  );
}
