import Swal from 'sweetalert2'

export function toastSuccess(title: string) {
  void Swal.fire({ toast: true, position: 'top-end', icon: 'success', title, showConfirmButton: false, timer: 2500, timerProgressBar: true })
}

export function toastError(title: string) {
  void Swal.fire({ toast: true, position: 'top-end', icon: 'error', title, showConfirmButton: false, timer: 3500, timerProgressBar: true })
}

// For an outcome that's expected/harmless rather than a failure (e.g. a file skipped
// because it's already been uploaded) — the red error icon on toastError reads as
// "something went wrong" even when nothing did.
export function toastInfo(title: string) {
  void Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title, showConfirmButton: false, timer: 3000, timerProgressBar: true })
}

export async function confirmDialog(opts: {
  title: string
  text?: string
  confirmButtonText?: string
  danger?: boolean
  input?: 'text'
  inputPlaceholder?: string
}): Promise<{ isConfirmed: boolean; value?: string }> {
  const res = await Swal.fire({
    title: opts.title,
    text: opts.text,
    input: opts.input,
    inputPlaceholder: opts.inputPlaceholder,
    showCancelButton: true,
    confirmButtonText: opts.confirmButtonText ?? 'Confirm',
    confirmButtonColor: opts.danger ? '#dc2626' : '#f97316',
  })
  return { isConfirmed: res.isConfirmed, value: res.value }
}
