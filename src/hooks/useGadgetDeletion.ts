import { useCallback } from 'react'
import { Gadget } from '../types'
import { removeGadgetReferencesFromGadgets, removeGadgetReferencesFromPlan, planReferencesGadget } from '../utils/gadgetDeletion'
import { useApp } from '../context/AppContext'
import { useGadgets } from './useGadgets'
import { usePlans } from './usePlans'

export function useGadgetDeletion() {
  const { gadgets, deletedGadgets, moveToTrash, replaceAll, restoreFromTrash } = useGadgets()
  const { plans, updateManyWith } = usePlans()
  const { lang } = useApp()

  const deleteGadgetsPermanently = useCallback(async (targets: Gadget[]) => {
    if (targets.length === 0) return
    const targetIds = new Set(targets.map((gadget) => gadget.id))
    const allGadgets = [...gadgets, ...deletedGadgets]
    const remainingGadgets = [...targetIds].reduce(
      (current, id) => removeGadgetReferencesFromGadgets(current, id),
      allGadgets,
    )
    const affectedPlans = plans.filter((plan) => [...targetIds].some((id) => planReferencesGadget(plan, id)))
    const originals = new Map(affectedPlans.map((plan) => [plan.id, plan]))
    const affectedIds = affectedPlans.map((plan) => plan.id)
    let plansPersisted = false

    try {
      await updateManyWith(
        affectedIds,
        (plan) => [...targetIds].reduce(
          (current, id) => removeGadgetReferencesFromPlan(current, id, remainingGadgets, lang),
          plan,
        ),
        { awaitPersistence: true, track: false },
      )
      plansPersisted = true
      await replaceAll(remainingGadgets, { awaitPersistence: true })
    } catch (error) {
      if (plansPersisted) {
        await updateManyWith(
          affectedIds,
          (plan) => originals.get(plan.id) ?? plan,
          { awaitPersistence: true, track: false },
        ).catch(() => {})
      }
      throw error
    }
  }, [deletedGadgets, gadgets, lang, plans, replaceAll, updateManyWith])

  const deleteGadget = useCallback(
    async (gadget: Gadget) => moveToTrash([gadget.id]),
    [moveToTrash],
  )

  const deleteGadgets = useCallback(
    async (targets: Gadget[]) => moveToTrash(targets.map((gadget) => gadget.id)),
    [moveToTrash],
  )

  const restoreGadgets = useCallback(
    async (targets: Gadget[]) => restoreFromTrash(targets.map((gadget) => gadget.id)),
    [restoreFromTrash],
  )

  const relatedDeskCount = useCallback(
    (gadgetId: string) => plans.filter((plan) => planReferencesGadget(plan, gadgetId)).length,
    [plans],
  )

  return {
    deleteGadget,
    deleteGadgets,
    deleteGadgetsPermanently,
    restoreGadgets,
    relatedDeskCount,
  }
}
