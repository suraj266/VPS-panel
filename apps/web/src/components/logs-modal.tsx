import { Modal } from "./modal";
import { LogStreamView } from "./log-stream-view";

export function LogsModal({
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
      title={`Logs — ${containerName}`}
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <LogStreamView containerId={containerId} tail={500} height="60vh" />
    </Modal>
  );
}
