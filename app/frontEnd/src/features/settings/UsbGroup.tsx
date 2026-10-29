import { useQuery } from '@tanstack/react-query'

import { systemApi } from '@/api/system'
import { ListGroup, ListRow } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n'

import { askReboot, switchesQuery, useSwitch } from './switches'

const isMac = () => /Macintosh|Mac OS X/i.test(navigator.userAgent) && !/iPhone|iPad/i.test(navigator.userAgent)

/**
 * USB 网络协议（0 自动 / 1 RNDIS / 2 CDC-ECM），重启后生效。
 * 从 Mac 切到 RNDIS 会让这台电脑再也连不上 USB 网络——用危险色确认，并把原因写清楚。
 */
export function UsbGroup() {
  const t = useT()
  const confirm = useConfirm()
  const switches = useQuery(switchesQuery)
  const protocol = useSwitch('usbProtocol', systemApi.setUsbProtocol)
  const value = switches.data?.usbProtocol
  const options = [
    { value: '0', label: t.netSettings.usbAuto },
    { value: '1', label: 'RNDIS' },
    { value: '2', label: 'CDC-ECM' },
  ]
  const known = options.some((option) => option.value === value)

  const change = async (next: string) => {
    const name = options.find((option) => option.value === next)?.label ?? next
    const risky = next === '1' && isMac()
    const ok = await confirm({
      tone: risky ? 'danger' : 'warning',
      title: t.netSettings.usbSwitchTitle(name),
      description: t.netSettings.usbSwitchBody,
      details: risky ? <span className="text-danger-text">{t.netSettings.usbMacWarning}</span> : undefined,
      confirmText: t.common.confirm,
    })
    if (!ok) return
    protocol.mutate(next, {
      onSuccess: () => toast.success(t.netSettings.usbDone, { duration: 8_000, action: { label: t.netSettings.rebootNow, onClick: () => askReboot(confirm, t) } }),
    })
  }

  return (
    <ListGroup title={t.netSettings.usbTitle} footer={t.netSettings.usbFooter}>
      <ListRow
        title={t.netSettings.usbProtocol}
        subtitle={value && !known ? t.netSettings.usbUnknown(value) : undefined}
        trailing={
          <SegmentedControl
            size="sm"
            ariaLabel={t.netSettings.usbProtocol}
            value={known ? value : undefined}
            disabled={!switches.data}
            pending={protocol.isPending}
            onChange={(next) => void change(next)}
            options={options}
          />
        }
      />
    </ListGroup>
  )
}
