
-- 1) prod_notifications: restrict coordinatore inserts
DROP POLICY IF EXISTS notif_insert_priv ON public.prod_notifications;

CREATE POLICY notif_insert_priv ON public.prod_notifications
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR (
    public.has_role(auth.uid(), 'coordinatore'::app_role)
    AND (
      -- target must be an assignee/creator on the related order, or share a commessa assignment with the actor
      (order_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.production_orders po
        WHERE po.id = prod_notifications.order_id
          AND (po.created_by = prod_notifications.user_id
               OR EXISTS (SELECT 1 FROM public.production_sub_orders ps
                          WHERE ps.order_id = po.id AND ps.assignee_id = prod_notifications.user_id))
      ))
      OR EXISTS (
        SELECT 1 FROM public.commessa_assegnatari ca
        WHERE ca.user_id = prod_notifications.user_id
          AND EXISTS (SELECT 1 FROM public.commessa_assegnatari ca2
                      WHERE ca2.commessa_id = ca.commessa_id AND ca2.user_id = auth.uid())
      )
    )
  )
);

-- 2) prod_chat_channels: split CUD
DROP POLICY IF EXISTS chan_cud_auth ON public.prod_chat_channels;

CREATE POLICY chan_insert_auth ON public.prod_chat_channels
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY chan_update_member_admin ON public.prod_chat_channels
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR auth.uid() = ANY(members)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR auth.uid() = ANY(members)
);

CREATE POLICY chan_delete_admin ON public.prod_chat_channels
FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
);
