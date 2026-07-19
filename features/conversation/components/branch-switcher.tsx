"use client";

import { useState } from "react";
import { Check, ChevronDown, GitBranch, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import {
  useBranches,
  useDeleteBranch,
  useRenameBranch,
  useSwitchBranch,
} from "../hooks/use-branches";

type BranchSwitcherProps = {
  conversationId: string;
  activeBranchId: string;
};

/** Header control for viewing, switching, renaming, and deleting branches. */
export function BranchSwitcher({
  conversationId,
  activeBranchId,
}: BranchSwitcherProps) {
  const { data: branches } = useBranches(conversationId);
  const switchMutation = useSwitchBranch(conversationId);
  const renameMutation = useRenameBranch(conversationId);
  const deleteMutation = useDeleteBranch(conversationId);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Only "main" exists yet — nothing to switch between, so stay out of the way.
  if (!branches || branches.length <= 1) return null;

  const activeBranch = branches.find((b) => b.id === activeBranchId);

  const commitRename = (branchId: string) => {
    const trimmed = renameValue.trim();
    const current = branches.find((b) => b.id === branchId)?.name;
    if (trimmed && trimmed !== current) {
      renameMutation.mutate({ branchId, name: trimmed });
    }
    setRenamingId(null);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger >
          <Button variant="outline" size="sm" className="gap-1.5">
            <GitBranch className="size-3.5" />
            <span className="max-w-32 truncate">
              {activeBranch?.name ?? "main"}
            </span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {branches.map((branch) => (
            <DropdownMenuItem
              key={branch.id}
              className="flex items-center justify-between gap-2"
              onSelect={(e) => {
                if (renamingId === branch.id) {
                  e.preventDefault();
                  return;
                }
                if (branch.id !== activeBranchId) {
                  switchMutation.mutate(branch.id);
                }
              }}
            >
              {renamingId === branch.id ? (
                <Input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(branch.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={() => commitRename(branch.id)}
                  className="h-7"
                />
              ) : (
                <>
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    {branch.id === activeBranchId && (
                      <Check className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">{branch.name}</span>
                  </span>
                  {!branch.isMain && (
                    <span className="flex shrink-0 gap-2">
                      <Pencil
                        className="size-3.5 opacity-50 hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(branch.id);
                          setRenameValue(branch.name);
                        }}
                      />
                      <Trash2
                        className="size-3.5 opacity-50 hover:text-destructive hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteId(branch.id);
                        }}
                      />
                    </span>
                  )}
                </>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={!!pendingDeleteId}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this branch?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes the branch pointer — none of the underlying
              messages are deleted, since they may be shared with other
              branches.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteId) deleteMutation.mutate(pendingDeleteId);
                setPendingDeleteId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}