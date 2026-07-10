import { Toaster as SonnerToaster } from "sonner";

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

export function Toaster({ ...props }: ToasterProps) {
  return (
    <SonnerToaster
      richColors
      closeButton
      position="bottom-center"
      toastOptions={{
        duration: 3000,
      }}
      {...props}
    />
  );
}
