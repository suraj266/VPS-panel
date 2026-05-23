import { Modal } from "./modal";
import { TerminalView } from "./terminal-view";

export function TerminalModal({
  containerId,
  containerName,
  onClose,
}: {
  containerId: string;
  containerName: string;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`Terminal — ${containerName}`}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <TerminalView containerId={containerId} height="60vh" />
    </Modal>
  );
}
