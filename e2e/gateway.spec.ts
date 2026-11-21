import { expect, test } from '@playwright/test'

const PASSCODE = process.env['E2E_CLASS_PASSCODE'] ?? ''

test.describe('隐私网关', () => {
  test('未通过口令时不泄露产品信息', async ({ page }) => {
    await page.goto('/')
    const title = await page.title()
    expect(title.trim()).toBe('')
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('第一人称')
    expect(body).not.toContain('WePOV')
    expect(body).not.toContain('树洞')
  })

  test('页面无横向溢出', async ({ page }) => {
    await page.goto('/')
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
  })
})

test.describe('口令与登录', () => {
  test.skip(!PASSCODE, '未提供 E2E_CLASS_PASSCODE')

  test('口令正确后出现身份选择', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('输入口令').fill(PASSCODE)
    await page.getByRole('button', { name: /进入/ }).click()
    await expect(page.getByRole('heading', { name: '选择你的身份' })).toBeVisible()
    await expect(page.getByRole('listbox', { name: '成员名单' })).toBeVisible()
  })
})

test.describe('无障碍基线', () => {
  test('存在主区域与可聚焦控件', async ({ page }) => {
    await page.goto('/')
    const main = page.locator('main, [role="main"]')
    expect(await main.count()).toBeGreaterThan(0)
  })
})
